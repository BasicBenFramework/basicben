import { validate, rules } from '@basicbenframework/core/validation'
import { hooks, HOOKS } from '@basicbenframework/core/hooks'
import { signJwt, verifyJwt, hashPassword, verifyPassword } from '@basicbenframework/core/auth'
import { ROLES, DEFAULT_ROLE } from '@basicbenframework/core/auth/permissions'
import { User } from '../models/User.js'
import { sendVerificationEmail } from './EmailVerificationController.js'

export const AuthController = {
  async register(req, res) {
    const result = await validate(req.body, {
      name: [rules.required, rules.string, rules.min(2)],
      email: [rules.required, rules.email],
      password: [rules.required, rules.min(8)]
    })

    if (result.fails()) {
      return res.json({ errors: result.errors }, 422)
    }

    const { name, email, password } = req.body

    // Check if email exists
    const existing = await User.findByEmail(email)
    if (existing) {
      return res.json({ error: 'Email already registered' }, 400)
    }

    // The first account to register is the operator setting the site up, so it
    // becomes the admin. Everyone after gets the least privileged role.
    const isFirstUser = (await User.count()) === 0
    const role = isFirstUser ? ROLES.ADMIN : DEFAULT_ROLE

    // The first account is the operator setting the site up, and on a fresh
    // install mail is very likely unconfigured. Requiring them to click a link
    // that was never delivered would lock them out of their own admin.
    const emailVerified = isFirstUser

    const user = await User.create({
      name,
      email,
      password: await hashPassword(password),
      role,
      email_verified: emailVerified ? 1 : 0,
      email_verified_at: emailVerified ? new Date().toISOString() : null
    })

    let verificationSent = false

    if (!emailVerified) {
      // A provider outage must not fail the registration — the account exists
      // either way, and the flag lets the client offer a resend.
      try {
        await sendVerificationEmail(user)
        verificationSent = true
      } catch (err) {
        console.error('Failed to send verification email:', err.message)
      }
    }

    const token = signJwt(
      { userId: user.id, role, email_verified: emailVerified },
      process.env.APP_KEY,
      { expiresIn: '7d' }
    )

    res.json({
      user: { id: user.id, name: user.name, email: user.email, role, email_verified: emailVerified },
      token,
      verificationSent
    })
  },

  async login(req, res) {
    const { email, password } = req.body

    if (!email || !password) {
      return res.json({ error: 'Email and password required' }, 400)
    }

    const user = await User.findByEmail(email)
    if (!user || !(await verifyPassword(password, user.password))) {
      return res.json({ error: 'Invalid credentials' }, 401)
    }

    const token = signJwt(
      { userId: user.id, role: user.role ?? DEFAULT_ROLE, email_verified: Boolean(user.email_verified) },
      process.env.APP_KEY,
      { expiresIn: '7d' }
    )

    res.json({
      user: {
        id: user.id, name: user.name, email: user.email,
        role: user.role ?? DEFAULT_ROLE, email_verified: Boolean(user.email_verified)
      },
      token
    })
  },

  async user(req, res) {
    const token = req.headers.authorization?.replace('Bearer ', '')
    if (!token) {
      return res.json({ error: 'No token provided' }, 401)
    }

    const payload = verifyJwt(token, process.env.APP_KEY)
    if (!payload) {
      return res.json({ error: 'Invalid token' }, 401)
    }

    const user = await User.find(payload.userId)
    if (!user) {
      return res.json({ error: 'User not found' }, 404)
    }

    res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role ?? DEFAULT_ROLE }
    })
  }
}
