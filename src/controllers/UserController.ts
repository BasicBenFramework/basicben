/**
 * The people who can sign in: listing them, changing what they may do,
 * switching them off, removing them, and inviting new ones.
 *
 * Every route here is behind `user.manage`, which only an admin holds. That
 * makes the admin role the one thing this controller must never let go to
 * zero: an install with no active admin has nobody who can grant the role
 * back, and the only fix is a hand-written SQL statement on the server. So
 * every write that can take admin away from someone — a role change, a
 * disable, a delete — goes through a conditional statement that refuses to
 * remove the last active admin, and refuses to let an admin do it to
 * themselves.
 *
 * The last-admin rule is enforced in the UPDATE/DELETE itself rather than by
 * counting first and writing second. Two admins demoting each other at the
 * same moment would both count two, both proceed, and leave none; a single
 * conditional statement cannot interleave like that.
 */

import { validate, rules } from '@basicbenframework/core/validation'
import { hashPassword } from '@basicbenframework/core/auth'
import { ROLES, isValidRole } from '@basicbenframework/core/auth/permissions'
import { issueToken, redeemToken, hashToken } from '@basicbenframework/core/auth/tokens'
import { sendMail, renderMail } from '@basicbenframework/core/mail'
import { getDb } from '@basicbenframework/core/db'
import { User } from '../models/User.ts'
import { paginationFrom, meta } from '../models/pagination.ts'
import { issueSessionToken, revokeSessions } from '../helpers/session.ts'
import type { Request, Response } from '../types/index.ts'

const appUrl = () => process.env.APP_URL || 'http://localhost:3000'
const siteName = () => process.env.SITE_NAME || 'BasicBen'

/**
 * The auth_tokens kind for an invitation.
 *
 * Kinds are plain strings in the framework, not a closed enum, so this needs
 * no framework change and no table of its own. The row's `user_id` is the
 * person who sent the invitation — the invitee has no account to point at
 * yet, and the column is NOT NULL — and who it is for travels in `metadata`.
 * A consequence worth knowing: deleting the sender cascades their pending
 * invitations away, which is the behaviour you would want anyway.
 */
export const INVITATION_KIND = 'invitation'

const INVITATION_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days

interface InvitationMetadata {
  email: string
  role: string
  name?: string | null
}

/**
 * The guard every admin-removing statement carries.
 *
 * True when the row being changed is not an active admin, or when some other
 * active admin would remain afterwards. `?` is the id of the row being
 * changed, so it is excluded from the count.
 */
const KEEPS_AN_ADMIN = `(
  role != 'admin'
  OR disabled_at IS NOT NULL
  OR (SELECT COUNT(*) FROM users AS others
      WHERE others.role = 'admin' AND others.disabled_at IS NULL AND others.id != ?) > 0
)`

const LAST_ADMIN = 'This is the only active admin. Make someone else an admin first.'

/** One row of the listing. Never the password; the address is fine here, behind user.manage. */
interface UserRow {
  id: number
  name: string
  email: string
  role: string
  slug: string | null
  email_verified: number | null
  disabled_at: string | null
  created_at: string
  post_count: number | string
}

function present(row: UserRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    slug: row.slug,
    email_verified: Boolean(row.email_verified),
    disabled_at: row.disabled_at,
    created_at: row.created_at,
    // Postgres returns COUNT(*) as a bigint, which arrives as a string.
    post_count: Number(row.post_count ?? 0)
  }
}

const SELECT_USERS = `
  SELECT users.id, users.name, users.email, users.role, users.slug,
         users.email_verified, users.disabled_at, users.created_at,
         (SELECT COUNT(*) FROM posts WHERE posts.user_id = users.id) AS post_count
  FROM users
`

async function findRow(id: number): Promise<UserRow | undefined> {
  const db = await getDb()
  return db.get(`${SELECT_USERS} WHERE users.id = ?`, [id])
}

function idParam(req: Request): number | null {
  const id = Number.parseInt(req.params.id, 10)
  return Number.isInteger(id) && id > 0 ? id : null
}

export const UserController = {
  /**
   * Everyone, a page at a time, newest first.
   *
   * `?search=` matches name or address; `?role=` narrows to one role. The post
   * count rides along so the delete dialog knows whether to ask where their
   * posts should go before the admin clicks anything.
   */
  async index(req: Request, res: Response) {
    const { page, perPage, offset } = paginationFrom(req.query)
    const db = await getDb()

    const conditions: string[] = []
    const params: unknown[] = []

    const search = (req.query.search ?? '').trim()
    if (search) {
      // Lowered on both sides because LIKE is case-insensitive on SQLite and
      // not on Postgres. `%` and `_` in the search are literals, not wildcards.
      const needle = `%${search.toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c)}%`
      conditions.push("(LOWER(users.name) LIKE ? ESCAPE '\\' OR LOWER(users.email) LIKE ? ESCAPE '\\')")
      params.push(needle, needle)
    }

    const role = req.query.role
    if (role && isValidRole(role)) {
      conditions.push('users.role = ?')
      params.push(role)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const counted = await db.get(`SELECT COUNT(*) AS total FROM users ${where}`, params)
    const total = Number(counted?.total ?? 0)

    // `id` breaks ties: created_at alone is not a total order, and paginating
    // a partial one serves a row twice and another never.
    const rows = (await db.all(
      `${SELECT_USERS} ${where}
       ORDER BY users.created_at DESC, users.id DESC
       LIMIT ? OFFSET ?`,
      [...params, perPage, offset]
    )) as UserRow[]

    res.json({
      users: rows.map(present),
      roles: Object.values(ROLES),
      meta: meta(page, perPage, total)
    })
  },

  /**
   * Rename someone, or change their role.
   *
   * A role change ends the account's sessions. The auth middleware reads the
   * role fresh on every request, so the new role would apply anyway; revoking
   * makes the change unmistakable — the client re-signs in and gets claims
   * that match, rather than carrying a token whose `role` says otherwise.
   */
  async update(req: Request, res: Response) {
    const id = idParam(req)
    if (!id) return res.json({ error: 'User not found' }, 404)

    const target = await findRow(id)
    if (!target) return res.json({ error: 'User not found' }, 404)

    const { name, role } = req.body as { name?: unknown; role?: unknown }

    if (name !== undefined) {
      const result = await validate({ name }, { name: [rules.required, rules.string, rules.min(2)] })
      if (result.fails()) return res.json({ errors: result.errors }, 422)
    }

    if (role !== undefined && (typeof role !== 'string' || !isValidRole(role))) {
      return res.json({ errors: { role: ['Unknown role'] } }, 422)
    }

    const roleChanges = typeof role === 'string' && role !== target.role

    if (roleChanges) {
      // Your own role is the one change that can strand you: demote yourself
      // and the screen you are on stops working mid-click. Another admin can
      // do it for you.
      if (id === req.userId) {
        return res.json({ error: 'You cannot change your own role. Ask another admin.' }, 400)
      }

      // Promoting to admin can never strand the site, so only a change *away*
      // from admin carries the guard.
      const db = await getDb()
      const changed = role === ROLES.ADMIN
        ? await db.run('UPDATE users SET role = ? WHERE id = ?', [role, id])
        : await db.run(`UPDATE users SET role = ? WHERE id = ? AND ${KEEPS_AN_ADMIN}`, [role, id, id])

      if ((changed.changes ?? 0) !== 1) {
        return res.json({ error: LAST_ADMIN }, 409)
      }

      await revokeSessions(id)
    }

    if (typeof name === 'string' && name !== target.name) {
      await User.update(id, { name })
    }

    res.json({ user: present((await findRow(id)) as UserRow) })
  },

  /**
   * Switch an account off without deleting it.
   *
   * Their posts keep their byline and nothing has to be reassigned. Sessions
   * end immediately, and sign-in refuses the account until it is enabled.
   */
  async disable(req: Request, res: Response) {
    const id = idParam(req)
    if (!id) return res.json({ error: 'User not found' }, 404)

    const target = await findRow(id)
    if (!target) return res.json({ error: 'User not found' }, 404)

    if (id === req.userId) {
      return res.json({ error: 'You cannot disable your own account.' }, 400)
    }

    if (target.disabled_at) {
      return res.json({ user: present(target) })
    }

    const db = await getDb()
    const changed = await db.run(
      `UPDATE users SET disabled_at = ? WHERE id = ? AND ${KEEPS_AN_ADMIN}`,
      [new Date().toISOString(), id, id]
    )

    if ((changed.changes ?? 0) !== 1) {
      return res.json({ error: LAST_ADMIN }, 409)
    }

    await revokeSessions(id)

    res.json({ user: present((await findRow(id)) as UserRow) })
  },

  /**
   * Switch an account back on.
   *
   * Their old sessions stay dead — disabling bumped the token version — so
   * they sign in again, which is what you would want after a suspension.
   */
  async enable(req: Request, res: Response) {
    const id = idParam(req)
    if (!id) return res.json({ error: 'User not found' }, 404)

    const db = await getDb()
    const changed = await db.run('UPDATE users SET disabled_at = NULL WHERE id = ?', [id])

    if ((changed.changes ?? 0) !== 1) return res.json({ error: 'User not found' }, 404)

    res.json({ user: present((await findRow(id)) as UserRow) })
  },

  /**
   * Remove an account.
   *
   * A post cannot lose its author — `posts.user_id` is NOT NULL and has no
   * cascade, deliberately, because deleting someone should never silently
   * delete what they published. So someone with posts is deleted only with
   * `?reassign=<userId>`, which moves their posts (trashed ones included) and
   * their uploads to that person first, the way WordPress asks "attribute all
   * content to…". Pages carry no author in this schema, so there is nothing of
   * theirs to move.
   *
   * Their credentials — API tokens, single-use links, second factors,
   * passkeys — are deleted explicitly rather than left to ON DELETE CASCADE,
   * since not every driver this runs on enforces foreign keys by default.
   */
  async destroy(req: Request, res: Response) {
    const id = idParam(req)
    if (!id) return res.json({ error: 'User not found' }, 404)

    const target = await findRow(id)
    if (!target) return res.json({ error: 'User not found' }, 404)

    if (id === req.userId) {
      return res.json({ error: 'You cannot delete your own account.' }, 400)
    }

    const postCount = Number(target.post_count ?? 0)
    const reassignTo = req.query.reassign ? Number.parseInt(req.query.reassign, 10) : null

    if (postCount > 0 && !reassignTo) {
      return res.json(
        {
          error: `${target.name} has ${postCount} post${postCount === 1 ? '' : 's'}. Choose someone to reassign them to.`,
          post_count: postCount
        },
        409
      )
    }

    if (reassignTo !== null) {
      if (!Number.isInteger(reassignTo) || reassignTo === id || !(await User.find(reassignTo))) {
        return res.json({ errors: { reassign: ['Choose another existing user to receive the content'] } }, 422)
      }
    }

    const db = await getDb()

    // One transaction, so a refused delete does not leave the posts already
    // moved to someone else, and a failed move does not leave a half-deleted
    // account. Throwing is how the refusal rolls the moves back.
    const refused = Symbol('last admin')

    try {
      await db.transaction(async (tx: any) => {
        if (reassignTo !== null) {
          await tx.run('UPDATE posts SET user_id = ? WHERE user_id = ?', [reassignTo, id])
          await tx.run('UPDATE media SET user_id = ? WHERE user_id = ?', [reassignTo, id])
        } else {
          await tx.run('UPDATE media SET user_id = NULL WHERE user_id = ?', [id])
        }

        await tx.run('UPDATE comments SET user_id = NULL WHERE user_id = ?', [id])
        await tx.run('DELETE FROM api_tokens WHERE user_id = ?', [id])
        await tx.run('DELETE FROM auth_tokens WHERE user_id = ?', [id])
        await tx.run('DELETE FROM user_two_factor WHERE user_id = ?', [id])
        await tx.run('DELETE FROM user_credentials WHERE user_id = ?', [id])

        const deleted = await tx.run(`DELETE FROM users WHERE id = ? AND ${KEEPS_AN_ADMIN}`, [id, id])
        if ((deleted.changes ?? 0) !== 1) throw refused
      })
    } catch (err) {
      if (err === refused) return res.json({ error: LAST_ADMIN }, 409)
      throw err
    }

    res.json({ message: `${target.name} was deleted.`, reassigned: reassignTo ? postCount : 0 })
  }
}

/** A pending invitation row as the admin sees it. */
interface InvitationRow {
  id: number
  metadata: string | null
  expires_at: string
  created_at: string
  invited_by: string | null
}

function parseMetadata(raw: string | null): InvitationMetadata | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed.email === 'string' ? parsed : null
  } catch {
    return null
  }
}

async function pendingInvitations(): Promise<Array<InvitationRow & { meta: InvitationMetadata }>> {
  const db = await getDb()
  const rows = (await db.all(
    `SELECT auth_tokens.id, auth_tokens.metadata, auth_tokens.expires_at, auth_tokens.created_at,
            users.name AS invited_by
     FROM auth_tokens
     LEFT JOIN users ON users.id = auth_tokens.user_id
     WHERE auth_tokens.kind = ? AND auth_tokens.used_at IS NULL AND auth_tokens.expires_at > ?
     ORDER BY auth_tokens.created_at DESC, auth_tokens.id DESC`,
    [INVITATION_KIND, new Date().toISOString()]
  )) as InvitationRow[]

  return rows.flatMap((row) => {
    const parsed = parseMetadata(row.metadata)
    return parsed ? [{ ...row, meta: parsed }] : []
  })
}

/**
 * Look a live invitation up without spending it.
 *
 * The framework's redeemToken consumes on read, which is right for the accept
 * but wrong for the page that has to show who the invitation is for before
 * anyone has typed a password.
 */
async function peekInvitation(token: unknown): Promise<{ hash: string; meta: InvitationMetadata } | null> {
  if (!token || typeof token !== 'string') return null

  const db = await getDb()
  const hash = hashToken(token)
  const row = await db.get(
    `SELECT metadata FROM auth_tokens
     WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ?`,
    [hash, INVITATION_KIND, new Date().toISOString()]
  )

  const parsed = row ? parseMetadata(row.metadata) : null
  return parsed ? { hash, meta: parsed } : null
}

const INVALID_INVITATION = 'This invitation is invalid, has expired, or has already been used.'

export const InvitationController = {
  /**
   * Invite someone by address.
   *
   * Sending another invitation to the same address replaces the earlier one,
   * so the newest email is always the one that works and the pending list
   * never shows the same person twice.
   */
  async store(req: Request, res: Response) {
    const result = await validate(req.body, {
      email: [rules.required, rules.email],
      role: [rules.required, rules.string]
    })

    if (result.fails()) return res.json({ errors: result.errors }, 422)

    const body = req.body as { email: string; name?: unknown; role: string }
    const email = body.email.trim()
    const role = body.role
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null

    if (!isValidRole(role)) {
      return res.json({ errors: { role: ['Unknown role'] } }, 422)
    }

    // Behind user.manage, so saying the address is taken leaks nothing the
    // admin could not see in the users table anyway.
    if (await User.findByEmail(email)) {
      return res.json({ error: 'Someone with that email already has an account.' }, 409)
    }

    const db = await getDb()
    const now = new Date().toISOString()
    for (const pending of await pendingInvitations()) {
      if (pending.meta.email.toLowerCase() === email.toLowerCase()) {
        await db.run('UPDATE auth_tokens SET used_at = ? WHERE id = ?', [now, pending.id])
      }
    }

    const { token, expiresAt } = await issueToken(req.userId!, INVITATION_KIND, {
      ttl: INVITATION_TTL,
      metadata: { email, role, name } satisfies InvitationMetadata
    })

    const inviteUrl = `${appUrl()}/invite/${token}`
    const inviter = await User.find(req.userId!)

    try {
      await sendMail({
        to: email,
        subject: `You're invited to ${siteName()}`,
        ...renderMail('invitation', {
          inviterName: inviter?.name ?? 'An administrator',
          siteName: siteName(),
          roleLabel: /^[aeiou]/.test(role) ? `an ${role}` : `a ${role}`,
          inviteUrl
        })
      })
    } catch (err) {
      // The invitation exists either way, and the admin can resend it. Saying
      // "invited" when the mail never left would leave them waiting on it.
      console.error('Failed to send invitation email:', (err as Error).message)
      return res.json({ error: 'The invitation was created but the email could not be sent. Try again shortly.' }, 502)
    }

    res.json({ message: `Invitation sent to ${email}.`, expiresAt: expiresAt.toISOString() }, 201)
  },

  /** Invitations nobody has accepted yet, and which have not expired. */
  async index(_req: Request, res: Response) {
    const pending = await pendingInvitations()

    res.json({
      invitations: pending.map((row) => ({
        id: row.id,
        email: row.meta.email,
        name: row.meta.name ?? null,
        role: row.meta.role,
        invited_by: row.invited_by,
        expires_at: row.expires_at,
        created_at: row.created_at
      }))
    })
  },

  /** Withdraw an invitation, so its link stops working. */
  async destroy(req: Request, res: Response) {
    const id = idParam(req)
    if (!id) return res.json({ error: 'Invitation not found' }, 404)

    const db = await getDb()
    const revoked = await db.run(
      'UPDATE auth_tokens SET used_at = ? WHERE id = ? AND kind = ? AND used_at IS NULL',
      [new Date().toISOString(), id, INVITATION_KIND]
    )

    if ((revoked.changes ?? 0) !== 1) return res.json({ error: 'Invitation not found' }, 404)

    res.json({ message: 'Invitation revoked.' })
  },

  /**
   * What the accept page needs to show: who this is for, and where.
   *
   * Public, because the person holding the link has no account yet. The link
   * is the credential — 32 random bytes — so answering for it reveals nothing
   * to someone who does not already have the email.
   */
  async show(req: Request, res: Response) {
    const invitation = await peekInvitation(req.params.token)
    if (!invitation) return res.json({ error: INVALID_INVITATION }, 404)

    res.json({
      email: invitation.meta.email,
      name: invitation.meta.name ?? null,
      role: invitation.meta.role,
      siteName: siteName()
    })
  },

  /**
   * Turn an invitation into an account and sign it in.
   *
   * Deliberately not subject to DISABLE_REGISTRATION: on a closed site an
   * invitation is the *only* way a new person gets in, and it is an admin who
   * opened the door, not the visitor. The address counts as verified because
   * following the emailed link is exactly what verification asks for.
   */
  async accept(req: Request, res: Response) {
    const result = await validate(req.body, {
      name: [rules.required, rules.string, rules.min(2)],
      password: [rules.required, rules.min(8)]
    })

    if (result.fails()) return res.json({ errors: result.errors }, 422)

    const { name, password } = req.body as { name: string; password: string }
    const token = req.params.token

    const invitation = await peekInvitation(token)
    if (!invitation) return res.json({ error: INVALID_INVITATION }, 404)

    const { email, role } = invitation.meta

    // The address may have registered on its own since the invitation went
    // out. Checked before the token is spent, so the link still works if the
    // other account is removed.
    if (await User.findByEmail(email) || !isValidRole(role)) {
      return res.json({ error: 'An account with this email already exists. Sign in instead.' }, 409)
    }

    // Hashed before the claim, so the slow part cannot widen the window
    // between spending the token and creating the account.
    const hashed = await hashPassword(password)

    // Spending the token is the atomic step: a single conditional UPDATE, so
    // two tabs submitting the same link cannot both create an account.
    const claimed = await redeemToken(token, INVITATION_KIND)
    if (!claimed) return res.json({ error: INVALID_INVITATION }, 404)

    let user
    try {
      user = await User.create({
        name,
        email,
        password: hashed,
        role,
        email_verified: 1,
        email_verified_at: new Date().toISOString()
      })
    } catch (err) {
      // Most likely the address was taken between the check and the insert.
      // Hand the link back, so the invitation is not lost to a race the
      // invitee did not cause.
      const db = await getDb()
      await db.run('UPDATE auth_tokens SET used_at = NULL WHERE token_hash = ? AND kind = ?', [
        invitation.hash,
        INVITATION_KIND
      ])
      console.error('Failed to create invited account:', (err as Error).message)
      return res.json({ error: 'Could not create the account. Please try again.' }, 409)
    }

    const sessionToken = issueSessionToken({ id: user.id, role, email_verified: 1, token_version: 0 })

    // The same shape login returns, so the client stores it the same way.
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role,
        email_verified: true
      },
      token: sessionToken
    })
  }
}
