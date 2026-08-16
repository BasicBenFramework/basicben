import { validate, rules } from '@basicbenframework/core/validation'
import { signJwt, verifyJwt, hashPassword, verifyPassword } from '@basicbenframework/core/auth'
import { ROLES, DEFAULT_ROLE } from '@basicbenframework/core/auth/permissions'
import { User } from '../models/User.js'

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

    const user = await User.create({
      name,
      email,
      password: await hashPassword(password),
      role
    })

    const token = signJwt({ userId: user.id, role }, process.env.APP_KEY, { expiresIn: '7d' })

    res.json({
      user: { id: user.id, name: user.name, email: user.email, role },
      token
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
      { userId: user.id, role: user.role ?? DEFAULT_ROLE },
      process.env.APP_KEY,
      { expiresIn: '7d' }
    )

    res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role ?? DEFAULT_ROLE },
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
