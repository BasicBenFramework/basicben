import { validate, rules } from '@basicbenframework/core/validation'
import { signJwt, verifyJwt, hashPassword, verifyPassword } from '@basicbenframework/core/auth'
import { ROLES, DEFAULT_ROLE } from '@basicbenframework/core/auth/permissions'
import { User } from '../models/User'
import { sendVerificationEmail } from './EmailVerificationController'
import { issueChallenge } from './TwoFactorController'
import { TwoFactor } from '../models/TwoFactor'
import type { Request, Response } from '../types'

interface JwtPayload {
  userId: number
  role?: string
  email_verified?: boolean
}

export const AuthController = {
  async register(req: Request, res: Response) {
    const result = await validate(req.body, {
      name: [rules.required, rules.string, rules.min(2)],
      email: [rules.required, rules.email],
      password: [rules.required, rules.min(8)]
    })

    if (result.fails()) {
      return res.json({ errors: result.errors }, 422)
    }

    const { name, email, password } = req.body as { name: string; email: string; password: string }

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
      // A provider outage must not fail the registration. The account exists
      // either way, so returning 500 here would leave the caller believing it
      // does not; the flag lets the client offer a resend instead.
      try {
        await sendVerificationEmail(user)
        verificationSent = true
      } catch (err) {
        console.error('Failed to send verification email:', (err as Error).message)
      }
    }

    const token = signJwt(
      { userId: user.id, role, email_verified: emailVerified },
      process.env.APP_KEY as string,
      { expiresIn: '7d' }
    )

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role,
        email_verified: emailVerified
      },
      token,
      verificationSent
    })
  },

  async login(req: Request, res: Response) {
    const { email, password } = req.body as { email?: string; password?: string }

    if (!email || !password) {
      return res.json({ error: 'Email and password required' }, 400)
    }

    const user = await User.findByEmail(email)
    if (!user || !(await verifyPassword(password, user.password))) {
      return res.json({ error: 'Invalid credentials' }, 401)
    }

    // With a second factor enrolled the password alone is not a session. The
    // caller gets a challenge to exchange at /api/auth/2fa/verify instead.
    const twoFactor = await TwoFactor.find(user.id)

    if (TwoFactor.isEnabled(twoFactor)) {
      const { challenge, expiresAt } = await issueChallenge(user.id)

      return res.json({
        twoFactorRequired: true,
        methods: ['totp', 'recovery'],
        challenge,
        expiresAt
      })
    }

    const token = signJwt(
      {
        userId: user.id,
        role: user.role ?? DEFAULT_ROLE,
        email_verified: Boolean(user.email_verified)
      },
      process.env.APP_KEY as string,
      { expiresIn: '7d' }
    )

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role ?? DEFAULT_ROLE,
        email_verified: Boolean(user.email_verified)
      },
      token
    })
  },

  async user(req: Request, res: Response) {
    const token = req.headers.authorization?.replace('Bearer ', '')
    if (!token) {
      return res.json({ error: 'No token provided' }, 401)
    }

    const payload = verifyJwt(token, process.env.APP_KEY as string) as JwtPayload | null
    if (!payload) {
      return res.json({ error: 'Invalid token' }, 401)
    }

    const user = await User.find(payload.userId)
    if (!user) {
      return res.json({ error: 'User not found' }, 404)
    }

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role ?? DEFAULT_ROLE,
        email_verified: Boolean(user.email_verified)
      }
    })
  }
}
