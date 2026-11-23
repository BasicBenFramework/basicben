/**
 * The members API: magic-link sign-in for readers, mounted at /api/v1/members.
 *
 * Called by headless front ends on other origins, so everything is bearer
 * tokens in headers and JSON bodies — no cookies, no redirects. The session
 * this hands out is a member session (helpers/member-auth.ts), which no admin
 * route accepts.
 *
 * Two rules shape the sign-in endpoint, the same two that shape password
 * reset: it never says whether an address is a member, and the link it sends
 * goes to a page the *site* configured, never one the caller named — a link
 * carrying a sign-in token to an attacker's page would be a phishing kit.
 */

import { sendMail, renderMail } from '@basicbenframework/core/mail'
import { Member, memberProfile, looksLikeEmail } from '../models/Member.ts'
import { Settings } from '../models/Settings.ts'
import { MEMBER_SIGNUP_MODES } from '../helpers/site-settings.ts'
import { siteUrl } from '../helpers/site.ts'
import {
  issueMagicLink,
  redeemMagicLink,
  issueMemberSession,
  readMemberUnsubscribeToken,
  normalizeEmail,
  MAGIC_LINK_TTL_MS
} from '../helpers/member-auth.ts'
import { emailSendLimiter } from '../middleware/rate-limits.ts'
import type { Request, Response } from '../types'

/** The one answer the magic-link endpoint gives, whoever asks. */
export const MAGIC_LINK_SENT = 'If that address can sign in, a link is on its way. It works once, for an hour.'

const INVALID_LINK = 'This sign-in link is invalid, has expired, or has already been used.'

export type SignupMode = (typeof MEMBER_SIGNUP_MODES)[number]

/** Who may become a member. Open unless the admin said otherwise. */
export async function signupMode(): Promise<SignupMode> {
  const value = await Settings.get('members_signup')
  return (MEMBER_SIGNUP_MODES as readonly string[]).includes(value ?? '') ? (value as SignupMode) : 'open'
}

/**
 * The page a magic link opens: the front end's, with `?token=` appended.
 *
 * That page POSTs the token to /api/v1/members/verify and keeps the session.
 * Pointing the mail at the API instead would let a mail scanner — which
 * follows every link in every message — spend the single-use token before the
 * reader ever clicked it.
 */
export async function signinUrl(token: string): Promise<string> {
  const configured = await Settings.get('members_signin_url')
  const base = configured || `${siteUrl()}/members/verify`
  const separator = base.includes('?') ? '&' : '?'
  return `${base}${separator}token=${encodeURIComponent(token)}`
}

/** A name a member gave, made safe to store and to put in a greeting. */
function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 100)
  return name || null
}

/** A bare page for the unsubscribe link, which is opened from a mail client. */
function page(res: Response, status: number, title: string, body: string) {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  // Never cached, never indexed, never leaked by referrer: the URL is a credential.
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex')
  res.status(status).send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>${escape(title)}</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 48px auto; padding: 0 16px; color: #111; line-height: 1.5;">
<h1 style="font-size: 20px;">${escape(title)}</h1>
${body}
</body></html>`)
}

const INVALID_UNSUBSCRIBE = '<p>It may have been copied incompletely. Nothing has changed.</p>'

export const MemberController = {
  /**
   * `POST /api/v1/members/magic-link` — `{ email, name?, newsletter? }`.
   *
   * Always 200 and always MAGIC_LINK_SENT for a well-formed address. Every
   * branch below — a member, a stranger on an invite-only site, a throttled
   * mailbox, a closed site, a provider outage — ends at the same response.
   *
   * The mail is awaited, as PasswordResetController's is and for its reason:
   * on a serverless host a fire-and-forget mail is frozen with the function,
   * and a sign-in link that never arrives is the whole feature failing. The
   * timing difference that leaves is one provider round trip, behind a
   * per-address and a per-mailbox limit.
   */
  async magicLink(req: Request, res: Response) {
    const body = (req.body ?? {}) as { email?: unknown; name?: unknown; newsletter?: unknown }
    const email = normalizeEmail(body.email)

    // A malformed address says nothing about membership, so it may be refused
    // for what it is.
    if (!email || !looksLikeEmail(email)) {
      return res.json({ errors: { email: ['A valid email address is required'] } }, 422)
    }

    // Consumed whether or not the address is a member, so the limit itself
    // cannot tell the two apart. Silent, for the same reason.
    const allowance = await emailSendLimiter.consume(`member-magic-link:${email}`)
    const mode = await signupMode()

    if (allowance.allowed && mode !== 'closed') {
      const member = await Member.findByEmail(email)

      // A stranger gets a sign-up link only where anyone may join; otherwise
      // nothing, and the same answer as everyone else.
      if (member || mode === 'open') {
        try {
          const token = await issueMagicLink({
            memberId: member?.id ?? null,
            email,
            metadata: member ? null : { name: cleanName(body.name), newsletter: body.newsletter !== false }
          })

          const siteName = await Settings.getSiteName()

          await sendMail({
            to: email,
            subject: member ? `Sign in to ${siteName}` : `Confirm your sign-up to ${siteName}`,
            ...renderMail('member-magic-link', {
              heading: member ? `Sign in to ${siteName}` : `Welcome to ${siteName}`,
              intro: member
                ? 'Use the button below to sign in. No password needed.'
                : 'Confirm your address to finish signing up. No password needed.',
              action: member ? 'Sign in' : 'Confirm and sign in',
              url: await signinUrl(token),
              minutes: Math.round(MAGIC_LINK_TTL_MS / 60_000),
              siteName
            })
          })
        } catch (err) {
          console.error('[members] magic link failed:', (err as Error)?.message ?? err)
        }
      }
    }

    return res.json({ message: MAGIC_LINK_SENT })
  },

  /**
   * `POST /api/v1/members/verify` `{ token }` (or `GET ?token=`) — spend a
   * magic link for a member session.
   *
   * GET is accepted because a front end handed the token in its own URL may
   * simply forward it; the mail itself never points here (see `signinUrl`).
   * Both are a single-use spend, so the response is never cacheable.
   */
  async verify(req: Request, res: Response) {
    res.setHeader('Cache-Control', 'no-store')

    const token = (req.body as { token?: unknown } | undefined)?.token ?? req.query?.token
    const redeemed = await redeemMagicLink(token)
    if (!redeemed) return res.json({ error: INVALID_LINK }, 400)

    const mode = await signupMode()
    if (mode === 'closed') return res.json({ error: 'Member sign-in is closed on this site.' }, 403)

    let member = await Member.findByEmail(redeemed.email)

    // A sign-in link names a member; if that member has since been deleted, or
    // their address changed, the link proves a mailbox that is no longer theirs.
    if (redeemed.memberId !== null && (!member || member.id !== redeemed.memberId)) {
      return res.json({ error: INVALID_LINK }, 400)
    }

    if (!member) {
      // A sign-up link, issued while sign-up was open. If it has closed since,
      // the link closes with it.
      if (mode !== 'open') return res.json({ error: INVALID_LINK }, 400)

      try {
        member = await Member.create({
          email: redeemed.email,
          name: redeemed.metadata?.name ?? null,
          status: redeemed.metadata?.newsletter === false ? 'unsubscribed' : 'active',
          source: 'signup',
          email_verified_at: new Date().toISOString()
        })
      } catch {
        // Two sign-up links for one address, both spent at once: the unique
        // email let one insert win, and that row is this member too.
        member = await Member.findByEmail(redeemed.email)
        if (!member) return res.json({ error: INVALID_LINK }, 400)
      }
    }

    await Member.markVerified(member.id)
    const fresh = (await Member.find(member.id))!

    res.json({ token: issueMemberSession(fresh), member: memberProfile(fresh) })
  },

  /** `GET /api/v1/members/me`. */
  async me(req: Request, res: Response) {
    res.setHeader('Cache-Control', 'no-store')
    res.json({ member: memberProfile(req.member!) })
  },

  /**
   * `PUT /api/v1/members/me` — `{ name?, newsletter? }`.
   *
   * The address is not changeable here: changing it would need a magic link to
   * the new one, and until that exists an admin changes it. Nothing else on
   * the row is a member's to write.
   */
  async update(req: Request, res: Response) {
    const body = (req.body ?? {}) as { name?: unknown; newsletter?: unknown }
    const changes: { name?: string | null; status?: 'active' | 'unsubscribed' } = {}

    if ('name' in body) {
      if (body.name !== null && typeof body.name !== 'string') return res.json({ errors: { name: ['Must be text'] } }, 422)
      changes.name = cleanName(body.name)
    }

    if ('newsletter' in body) {
      if (typeof body.newsletter !== 'boolean') return res.json({ errors: { newsletter: ['Must be true or false'] } }, 422)
      changes.status = body.newsletter ? 'active' : 'unsubscribed'
    }

    const updated = await Member.update(req.member!.id, changes)
    res.setHeader('Cache-Control', 'no-store')
    res.json({ member: memberProfile(updated!) })
  },

  /**
   * `POST /api/v1/members/signout` — end every session this member holds.
   *
   * Sessions are stateless, so "this one" cannot be ended alone; bumping the
   * member's session version ends all of them, which is also what a reader
   * signing out of a shared computer wants.
   */
  async signout(req: Request, res: Response) {
    await Member.revokeSessions(req.member!.id)
    res.json({ message: 'Signed out.' })
  },

  /**
   * `GET /api/v1/members/unsubscribe?token=` — a confirmation page.
   *
   * GET only shows a button: mail scanners open every link, and a GET that
   * unsubscribed would unsubscribe people who never clicked.
   */
  async unsubscribePage(req: Request, res: Response) {
    const token = String(req.query?.token ?? '')
    if (!readMemberUnsubscribeToken(token)) return page(res, 400, 'This link is not valid', INVALID_UNSUBSCRIBE)

    return page(res, 200, 'Unsubscribe from the newsletter?',
      `<p>You will stop receiving posts by email. You can still sign in and read the site.</p>
<form method="post" action="/api/v1/members/unsubscribe?token=${encodeURIComponent(token)}">
<button type="submit" style="background: #111; color: #fff; border: 0; padding: 10px 20px; border-radius: 6px; font-size: 15px; cursor: pointer;">Unsubscribe</button>
</form>`)
  },

  /**
   * `POST /api/v1/members/unsubscribe?token=` — unsubscribe.
   *
   * Also the RFC 8058 one-click target: a mail client POSTs
   * `List-Unsubscribe=One-Click` here and reads only the status. No session
   * or CSRF token, because the signed link is the authority and the only
   * thing it can do is stop mail.
   */
  async unsubscribe(req: Request, res: Response) {
    const id = readMemberUnsubscribeToken(req.query?.token ?? (req.body as { token?: unknown } | undefined)?.token)
    if (!id) return page(res, 400, 'This link is not valid', INVALID_UNSUBSCRIBE)

    // A deleted member has nothing to stop; the answer is the same.
    const member = await Member.find(id)
    if (member && member.status !== 'unsubscribed') await Member.update(id, { status: 'unsubscribed' })

    return page(res, 200, 'Unsubscribed', '<p>You will no longer receive posts by email.</p>')
  }
}
