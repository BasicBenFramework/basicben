import { validate, rules } from '@basicbenframework/core/validation'
import { User } from '../models/User'
import { createHash } from 'node:crypto'
import type { Request, Response } from '../types'

function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex')
}

/**
 * The account, and the author profile attached to it.
 *
 * These are the same record: `users` holds both the credentials and the byline.
 * What separates them is who may see which half — the address and the role stay
 * here, behind the session; the profile travels to every published post.
 */
export const ProfileController = {
  async show(req: Request, res: Response) {
    const user = await User.find(req.userId!)
    if (!user) {
      return res.json({ error: 'User not found' }, 404)
    }

    const profile = await User.profile(req.userId!)

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        slug: user.slug ?? null,
        bio: user.bio ?? null,
        website: user.website ?? null,
        avatar_id: user.avatar_id ?? null,
        // Resolved through the storage adapter, so the form can show the
        // picture rather than a media id.
        avatar_url: profile?.avatar_url ?? null,
        created_at: user.created_at
      }
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

    const { name, email, slug, bio, website, avatar_id } = req.body as {
      name: string
      email: string
      slug?: string
      bio?: string
      website?: string
      avatar_id?: number | null
    }

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

    // Only what the request actually carried. A client that knows nothing about
    // profiles — the framework's own signup form, anything written before this
    // — sends name and email, and must not blank a biography by omission.
    const profile: Record<string, unknown> = { name, email }

    // Blank asks for one derived from the name, the way it was set at
    // registration; the model makes whatever it gets unique.
    if (typeof slug === 'string') profile.slug = slug.trim() || name
    if (typeof bio === 'string') profile.bio = bio.trim() || null
    if (typeof website === 'string') profile.website = website.trim() || null
    if ('avatar_id' in req.body) profile.avatar_id = Number(avatar_id) || null

    const updated = await User.update(req.userId!, profile)
    const shaped = await User.profile(req.userId!)

    res.json({
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        slug: updated.slug ?? null,
        bio: updated.bio ?? null,
        website: updated.website ?? null,
        avatar_id: updated.avatar_id ?? null,
        avatar_url: shaped?.avatar_url ?? null
      }
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
