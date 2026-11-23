/**
 * Members and newsletters, from the admin.
 *
 * Member management is behind `user.manage` — only the admin role holds it —
 * because a member list is a list of other people's email addresses: who may
 * read it, export it or import into it is the same question as who may manage
 * accounts. Newsletter status and test sends are per post, behind the post's
 * own edit rule (see the route file).
 */

import { can } from '@basicbenframework/core/auth/permissions'
import { getDb } from '@basicbenframework/core/db'
import { Member, MEMBER_STATUSES, normalizeLabels, looksLikeEmail, type MemberRow, type MemberStatus } from '../models/Member.ts'
import { normalizeEmail } from '../helpers/member-auth.ts'
import { paginationFrom, meta } from '../models/pagination.ts'
import { parseCsv, toCsv } from '../helpers/csv.ts'
import { newsletterFor, sendTestNewsletter, kickNewsletterQueue } from '../helpers/newsletter.ts'
import { emailSendLimiter } from '../middleware/rate-limits.ts'
import type { Request, Response } from '../types'

/** Rows one import request may carry. Sequential inserts on a remote database are not free. */
export const MAX_IMPORT_ROWS = 5000

/** What the admin sees: everything on the row but the session counter. */
function adminView(row: MemberRow) {
  const { session_version: _sessions, ...rest } = row
  return { ...rest, newsletter: row.status === 'active' }
}

/** The member fields an admin may set, validated. */
function memberFields(body: Record<string, unknown>, { creating }: { creating: boolean }):
  | { values: { email?: string; name?: string | null; note?: string | null; labels?: string | null; status?: MemberStatus } }
  | { errors: Record<string, string[]> } {
  const values: { email?: string; name?: string | null; note?: string | null; labels?: string | null; status?: MemberStatus } = {}
  const errors: Record<string, string[]> = {}

  if (creating || 'email' in body) {
    const email = normalizeEmail(body.email)
    if (!email || !looksLikeEmail(email)) errors.email = ['A valid email address is required']
    else values.email = email
  }

  for (const key of ['name', 'note'] as const) {
    if (key in body) {
      const value = body[key]
      if (value !== null && typeof value !== 'string') errors[key] = ['Must be text']
      else values[key] = value ? String(value).trim().slice(0, key === 'name' ? 100 : 2000) || null : null
    }
  }

  if ('labels' in body) values.labels = normalizeLabels(body.labels)

  if ('newsletter' in body) {
    if (typeof body.newsletter !== 'boolean') errors.newsletter = ['Must be true or false']
    else values.status = body.newsletter ? 'active' : 'unsubscribed'
  } else if ('status' in body) {
    if (!(MEMBER_STATUSES as string[]).includes(String(body.status))) errors.status = [`Must be one of ${MEMBER_STATUSES.join(', ')}`]
    else values.status = body.status as MemberStatus
  }

  return Object.keys(errors).length ? { errors } : { values }
}

/** A CSV truthy/falsy cell. Blank is "not said". */
function csvFlag(value: string | undefined): boolean | undefined {
  const v = String(value ?? '').trim().toLowerCase()
  if (['true', 'yes', 'y', '1', 'subscribed', 'active'].includes(v)) return true
  if (['false', 'no', 'n', '0', 'unsubscribed'].includes(v)) return false
  return undefined
}

export const MemberAdminController = {
  /** `GET /api/members?search=&status=&page=` — a page, and the counts above it. */
  async index(req: Request, res: Response) {
    const { page, perPage, offset } = paginationFrom(req.query as Record<string, string>)
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 200) : ''
    const status = (MEMBER_STATUSES as string[]).includes(req.query.status) ? (req.query.status as MemberStatus) : undefined

    const { members, total } = await Member.paginate({ perPage, offset, search: search || undefined, status })

    res.json({ members: members.map(adminView), meta: meta(page, perPage, total), counts: await Member.counts() })
  },

  /** `POST /api/members` — add one by hand. No mail is sent; they sign in when they choose. */
  async store(req: Request, res: Response) {
    const fields = memberFields((req.body ?? {}) as Record<string, unknown>, { creating: true })
    if ('errors' in fields) return res.json({ errors: fields.errors }, 422)

    if (await Member.findByEmail(fields.values.email!)) {
      return res.json({ errors: { email: ['A member with this address already exists'] } }, 422)
    }

    const member = await Member.create({ ...fields.values, email: fields.values.email!, source: 'admin' })
    res.json({ member: adminView(member) }, 201)
  },

  /** `PUT /api/members/:id`. */
  async update(req: Request, res: Response) {
    const id = Number(req.params.id)
    const existing = Number.isInteger(id) ? await Member.find(id) : undefined
    if (!existing) return res.json({ error: 'Member not found' }, 404)

    const fields = memberFields((req.body ?? {}) as Record<string, unknown>, { creating: false })
    if ('errors' in fields) return res.json({ errors: fields.errors }, 422)

    if (fields.values.email && fields.values.email !== existing.email) {
      const clash = await Member.findByEmail(fields.values.email)
      if (clash) return res.json({ errors: { email: ['A member with this address already exists'] } }, 422)
    }

    const member = await Member.update(id, fields.values)
    res.json({ member: adminView(member!) })
  },

  /** `DELETE /api/members/:id` — gone, with their sessions and any mail not yet sent to them. */
  async destroy(req: Request, res: Response) {
    const id = Number(req.params.id)
    const existing = Number.isInteger(id) ? await Member.find(id) : undefined
    if (!existing) return res.json({ error: 'Member not found' }, 404)

    await Member.delete(id)
    res.json({ message: 'Member deleted' })
  },

  /**
   * `POST /api/members/import` — `{ csv: "<text>" }`.
   *
   * A header row naming the columns is required, with at least `email`;
   * `name`, `note`, `labels` and `subscribed` (yes/no, true/false) are read if
   * present, in any order, and anything else is ignored. An address that is
   * already a member is skipped, not overwritten: an import is for adding
   * people, and silently re-subscribing someone who unsubscribed would be the
   * worst thing it could do.
   *
   * The CSV travels as a JSON string rather than a multipart upload: the body
   * parser already handles JSON, and a member list fits comfortably in its
   * 1 MB limit. Larger lists go in several requests.
   */
  async import(req: Request, res: Response) {
    const text = (req.body as { csv?: unknown } | undefined)?.csv
    if (typeof text !== 'string' || !text.trim()) return res.json({ errors: { csv: ['CSV text is required'] } }, 422)

    const rows = parseCsv(text)
    const header = (rows.shift() ?? []).map(cell => cell.trim().toLowerCase())
    const column = (name: string) => header.indexOf(name)
    const at = { email: column('email'), name: column('name'), note: column('note'), labels: column('labels'), subscribed: column('subscribed') }

    if (at.email === -1) return res.json({ errors: { csv: ['The first row must name the columns, including "email"'] } }, 422)
    if (rows.length > MAX_IMPORT_ROWS) {
      return res.json({ errors: { csv: [`At most ${MAX_IMPORT_ROWS} rows per import; split the file`] } }, 422)
    }

    const result = { imported: 0, existing: 0, invalid: 0, errors: [] as Array<{ row: number; error: string }> }
    const seen = new Set<string>()

    for (const [index, cells] of rows.entries()) {
      const line = index + 2
      const email = normalizeEmail(cells[at.email])

      if (!email || !looksLikeEmail(email)) {
        result.invalid++
        if (result.errors.length < 50) result.errors.push({ row: line, error: 'Not a valid email address' })
        continue
      }

      if (seen.has(email) || (await Member.findByEmail(email))) {
        result.existing++
        continue
      }
      seen.add(email)

      const cell = (i: number) => (i === -1 ? undefined : cells[i]?.trim())
      const subscribed = csvFlag(cell(at.subscribed))

      try {
        await Member.create({
          email,
          name: cell(at.name)?.slice(0, 100) || null,
          note: cell(at.note)?.slice(0, 2000) || null,
          labels: normalizeLabels(cell(at.labels)),
          status: subscribed === false ? 'unsubscribed' : 'active',
          source: 'import'
        })
        result.imported++
      } catch (err) {
        result.invalid++
        if (result.errors.length < 50) result.errors.push({ row: line, error: String((err as Error)?.message ?? err).slice(0, 200) })
      }
    }

    res.json(result)
  },

  /**
   * `GET /api/members/export` — every member, as CSV.
   *
   * The same columns the import reads, so an export can be imported
   * elsewhere. Cells are defused against spreadsheet formulas (helpers/csv.ts).
   */
  async export(_req: Request, res: Response) {
    const members = await Member.all()
    const csv = toCsv([
      ['email', 'name', 'subscribed', 'labels', 'note', 'source', 'email_verified_at', 'created_at', 'last_seen_at'],
      ...members.map(m => [
        m.email, m.name, m.status === 'active' ? 'yes' : 'no', m.labels, m.note, m.source,
        m.email_verified_at, m.created_at, m.last_seen_at
      ])
    ])

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="members-${new Date().toISOString().slice(0, 10)}.csv"`)
    // A list of addresses: never stored by anything between here and the admin.
    res.setHeader('Cache-Control', 'no-store')
    res.end(csv)
  },

  /** `GET /api/newsletters` — recent sends, newest first, for the Members page. */
  async sends(_req: Request, res: Response) {
    const db = await getDb()
    const sends = await db.all(
      `SELECT s.*, p.title AS post_title
       FROM newsletter_sends s LEFT JOIN posts p ON p.id = s.post_id
       ORDER BY s.created_at DESC, s.id DESC LIMIT 20`
    )
    kickNewsletterQueue()
    res.json({ sends })
  },

  /**
   * `GET /api/posts/:id/newsletter` — has this post been mailed, and how far along.
   *
   * Also nudges the queue: an editor watching a send's progress is traffic,
   * and on a serverless host without a cron it is what moves the send along.
   */
  async status(req: Request, res: Response) {
    const post = req.resource as { id: number; send_newsletter?: number } | undefined
    const send = await newsletterFor(Number(post?.id))
    if (send && send.status !== 'sent') kickNewsletterQueue()

    res.json({
      requested: Boolean(Number(post?.send_newsletter ?? 0)),
      send: send ?? null,
      may_send: can(req.user, 'post.edit')
    })
  },

  /**
   * `POST /api/posts/:id/newsletter/test` — mail it to yourself, as members will see it.
   *
   * To the signed-in account's own address and nowhere else: a test send that
   * took a recipient would be a way to mail anyone anything from the site.
   */
  async test(req: Request, res: Response) {
    const post = req.resource as { id: number } | undefined
    const db = await getDb()
    const user = (await db.get('SELECT email FROM users WHERE id = ?', [req.userId])) as { email?: string } | undefined
    if (!user?.email) return res.json({ error: 'Your account has no email address.' }, 422)

    const allowance = await emailSendLimiter.consume(`newsletter-test:${req.userId}`)
    if (!allowance.allowed) {
      res.setHeader('Retry-After', String(allowance.retryAfter))
      return res.json({ error: 'Too many test sends. Please wait a few minutes.' }, 429)
    }

    try {
      const sent = await sendTestNewsletter(Number(post?.id), user.email)
      if (!sent) return res.json({ error: 'Post not found' }, 404)
    } catch (err) {
      return res.json({ error: `The mail provider refused it: ${String((err as Error)?.message ?? err).slice(0, 200)}` }, 502)
    }

    res.json({ message: `Sent to ${user.email}.` })
  }
}
