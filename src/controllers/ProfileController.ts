import { validate, rules } from '@basicbenframework/core/validation'
import { User } from '../models/User'
import { createHash } from 'node:crypto'
import type { Request, Response } from '../types'

function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex')
}

export const ProfileController = {
  async show(req: Request, res: Response) {
    const user = await User.find(req.userId!)
    if (!user) {
      return res.json({ error: 'User not found' }, 404)
    }
    res.json({
      user: { id: user.id, name: user.name, email: user.email, created_at: user.created_at }
    })
  },

  async update(req: Request, res: Response) {
    const result = await validate(req.body, {
      name: [rules.required, rules.string, rules.min(2)],
      email: [rules.required, rules.email]
    })

    if (result.fails()) {
      return res.json({ errors: result.errors }, 422)
    }

    const { name, email } = req.body as { name: string; email: string }
    const user = await User.find(req.userId!)

    if (!user) {
      return res.json({ error: 'User not found' }, 404)
    }

    if (email !== user.email) {
      const existing = await User.findByEmail(email)
      if (existing) {
        return res.json({ error: 'Email already taken' }, 400)
      }
    }

    const updated = await User.update(req.userId!, { name, email })
    res.json({
      user: { id: updated.id, name: updated.name, email: updated.email }
    })
  },

  async changePassword(req: Request, res: Response) {
    const result = await validate(req.body, {
      currentPassword: [rules.required],
      newPassword: [rules.required, rules.min(8)]
    })

    if (result.fails()) {
      return res.json({ errors: result.errors }, 422)
    }

    const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string }
    const user = await User.find(req.userId!)

    if (!user) {
      return res.json({ error: 'User not found' }, 404)
    }

    if (user.password !== hashPassword(currentPassword)) {
      return res.json({ error: 'Current password is incorrect' }, 400)
    }

    await User.update(req.userId!, { password: hashPassword(newPassword) })
    res.json({ message: 'Password updated successfully' })
  }
}
