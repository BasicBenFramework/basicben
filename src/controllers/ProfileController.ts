import { validate, rules } from '@basicbenframework/core/validation'
import { User } from '../models/User'
import { hashPassword, verifyPassword } from '@basicbenframework/core/auth'
import { resetVerification, sendVerificationEmail } from './EmailVerificationController'
import { issueSessionToken, revokeSessions } from '../helpers/session'
import type { Request, Response } from '../types'

/**
 * An http(s) URL or nothing.
 *
 * The website travels to every byline through /api/v1, where a headless
 * consumer may render it as a link without React's protection against
 * `javascript:` URLs.
 */
function safeWebsite(value: string): string | null | false {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : false
  } catch {
    return false
  }
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

    const emailChanged = email !== user.email

    if (emailChanged) {
      // The address is where password resets go, so changing it is taking
      // over the account. A session alone — one left open on a shared
      // machine, or stolen — must not be enough.
      const currentPassword = (req.body as { currentPassword?: string }).currentPassword
      if (!currentPassword || !(await verifyPassword(currentPassword, user.password))) {
        return res.json({ error: 'Enter your current password to change your email address.' }, 403)
      }

      const existing = await User.findByEmail(email)
      if (existing) {
        return res.json({ error: 'Email already taken' }, 400)
      }
    }

    let cleanWebsite: string | null | undefined
    if (typeof website === 'string') {
      const checked = safeWebsite(website)
      if (checked === false) {
        return res.json({ errors: { website: ['Website must be an http or https URL'] } }, 422)
      }
      cleanWebsite = checked
    }

    // Only what the request actually carried. A client that knows nothing about
    // profiles — the framework's own signup form, anything written before this
    // — sends name and email, and must not blank a biography by omission.
    const profile: Record<string, unknown> = { name, email }

    // Blank asks for one derived from the name, the way it was set at
    // registration; the model makes whatever it gets unique.
    if (typeof slug === 'string') profile.slug = slug.trim() || name
    if (typeof bio === 'string') profile.bio = bio.trim() || null
    if (cleanWebsite !== undefined) profile.website = cleanWebsite
    if ('avatar_id' in req.body) profile.avatar_id = Number(avatar_id) || null

    const updated = await User.update(req.userId!, profile)

    // A new address has not been confirmed by anyone. Keeping the old flag
    // would let an account claim any address as verified.
    let verificationSent = false
    if (emailChanged) {
      await resetVerification(req.userId!)
      try {
        await sendVerificationEmail({ ...updated, email })
        verificationSent = true
      } catch (err) {
        console.error('Failed to send verification email:', (err as Error).message)
      }
    }

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
      },
      ...(emailChanged ? { emailChanged: true, verificationSent } : {})
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

    if (!(await verifyPassword(currentPassword, user.password))) {
      return res.json({ error: 'Current password is incorrect' }, 400)
    }

    // The framework's scrypt hash, the same one registration writes. This
    // used to compare and store unsalted SHA-256, so it never matched and
    // nobody could change a password at all.
    await User.update(req.userId!, { password: await hashPassword(newPassword) })

    // A changed password is usually a response to a suspected compromise, so
    // every other session ends. This one carries on with a fresh token.
    await revokeSessions(req.userId!)
    const fresh = await User.find(req.userId!)

    res.json({ message: 'Password updated successfully', token: issueSessionToken(fresh!) })
  }
}
