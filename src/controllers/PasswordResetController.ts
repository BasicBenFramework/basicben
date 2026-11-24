/**
 * Forgotten passwords.
 *
 * Two rules shape everything here.
 *
 * The request endpoint must not say whether an address has an account. It
 * answers every request with the same status and the same words, and the
 * per-mailbox limit that throttles it is applied silently rather than as a
 * 429 that only registered addresses could ever trigger.
 *
 * And a reset link is proof of a mailbox, not of a person. For an account with
 * a second factor that is not enough to sign in on: whoever reads the mail
 * could otherwise set a password and walk past TOTP or a passkey. So the reset
 * changes the password and ends every session, but only an account without a
 * second factor gets a session back — everyone else signs in the normal way,
 * second factor included.
 */

import { validate, rules } from '@basicbenframework/core/validation'
import { hashPassword } from '@basicbenframework/core/auth'
import { DEFAULT_ROLE } from '@basicbenframework/core/auth/permissions'
import { issueToken, redeemToken, revokeTokens, TOKEN_KINDS } from '@basicbenframework/core/auth/tokens'
import { sendMail, renderMail } from '@basicbenframework/core/mail'
import { User } from '../models/User.ts'
import { TwoFactor } from '../models/TwoFactor.ts'
import { Credential } from '../models/Credential.ts'
import { emailSendLimiter } from '../middleware/rate-limits.ts'
import { issueSessionToken, revokeSessions } from '../helpers/session.ts'
import type { Request, Response } from '../types/index.ts'

const appUrl = () => process.env.APP_URL || 'http://localhost:3000'

const RESET_TTL = 60 * 60 * 1000 // 1 hour

/** The one answer the request endpoint gives, whoever asks. */
export const RESET_REQUESTED =
  'If an account exists for that email, a link to reset its password is on its way.'

const INVALID_LINK = 'This reset link is invalid, has expired, or has already been used.'

/**
 * Issue a reset link and mail it.
 *
 * Earlier links are revoked first, so only the newest email works — someone
 * who asked twice and clicks the older one should not get a working reset
 * from a link they may have forwarded or left lying around.
 */
async function sendResetEmail(user: { id: number; name: string; email: string }) {
  await revokeTokens(user.id, TOKEN_KINDS.PASSWORD_RESET)

  const { token } = await issueToken(user.id, TOKEN_KINDS.PASSWORD_RESET, {
    ttl: RESET_TTL,
    metadata: { email: user.email }
  })

  const resetUrl = `${appUrl()}/reset-password/${token}`

  await sendMail({
    to: user.email,
    subject: 'Reset your password',
    ...renderMail('password-reset', {
      name: user.name,
      siteName: process.env.SITE_NAME || 'BasicBen',
      resetUrl
    })
  })
}

export const PasswordResetController = {
  /**
   * Ask for a reset link.
   *
   * Always 200, always RESET_REQUESTED. Every branch below — no such account,
   * a disabled one, a throttled mailbox, a provider outage — ends at the same
   * response, and that is the whole contract.
   *
   * The mail is awaited rather than sent after responding, which leaves a
   * timing difference of one provider round trip between an address that has
   * an account and one that does not. Fire-and-forget would close it, but on
   * a serverless deploy the function is frozen once the response is written
   * and the mail would simply never leave. A link that works beats a timing
   * channel that the per-address limit already makes slow to exploit.
   */
  async request(req: Request, res: Response) {
    const result = await validate(req.body, { email: [rules.required, rules.email] })

    // A malformed address is refused for what it is. It says nothing about
    // whether any account exists, so it does not need the uniform answer.
    if (result.fails()) return res.json({ errors: result.errors }, 422)

    const email = String((req.body as { email: string }).email).trim()

    // Consumed whether or not the account exists, so the limit itself cannot
    // be used to tell the two apart.
    const allowance = await emailSendLimiter.consume(`password-reset:${email.toLowerCase()}`)

    if (allowance.allowed) {
      const user = await User.findByEmail(email)

      // Disabled accounts get nothing: a reset would not let them sign in,
      // and the mail would tell them the account still exists.
      if (user && !(user as { disabled_at?: string | null }).disabled_at) {
        try {
          await sendResetEmail(user)
        } catch (err) {
          console.error('Failed to send password reset email:', (err as Error).message)
        }
      }
    }

    return res.json({ message: RESET_REQUESTED })
  },

  /**
   * Spend a reset link on a new password.
   *
   * Redeeming is the atomic step — a single conditional UPDATE in the
   * framework — so one link cannot set two passwords.
   */
  async reset(req: Request, res: Response) {
    const result = await validate(req.body, {
      token: [rules.required, rules.string],
      password: [rules.required, rules.min(8)]
    })

    if (result.fails()) return res.json({ errors: result.errors }, 422)

    const { token, password } = req.body as { token: string; password: string }

    // Hashed before the token is spent, so a slow scrypt cannot leave a
    // consumed link and an unchanged password if the request dies midway.
    const hashed = await hashPassword(password)

    const redeemed = await redeemToken(token, TOKEN_KINDS.PASSWORD_RESET)
    if (!redeemed) return res.json({ error: INVALID_LINK }, 400)

    const user = await User.find(redeemed.userId)

    // The link proves the mailbox it was sent to. If the account's address has
    // changed since, it proves nothing about the account.
    const issuedFor = (redeemed.metadata as { email?: string } | null)?.email
    if (!user || (issuedFor && issuedFor !== user.email) || (user as { disabled_at?: string | null }).disabled_at) {
      return res.json({ error: INVALID_LINK }, 400)
    }

    await User.update(user.id, {
      password: hashed,
      // Following the emailed link is the same proof verification asks for.
      email_verified: 1,
      email_verified_at: user.email_verified ? (user.email_verified_at ?? new Date().toISOString()) : new Date().toISOString()
    })

    // Every session ends, on every device: if the reset is because someone
    // else had the password, their session must not outlive it.
    await revokeSessions(user.id)
    await revokeTokens(user.id, TOKEN_KINDS.PASSWORD_RESET)

    const twoFactor = await TwoFactor.find(user.id)
    const passkeyCount = await Credential.countForUser(user.id)

    if (TwoFactor.isEnabled(twoFactor) || passkeyCount > 0) {
      // No session: a mailbox is one factor, and this account asked for two.
      return res.json({
        message: 'Your password has been changed. Sign in with it to continue.',
        signInRequired: true
      })
    }

    // Re-read, so the session carries the token version revokeSessions just
    // bumped — one minted from the stale row would be dead on arrival.
    const fresh = (await User.find(user.id))!

    res.json({
      message: 'Your password has been changed.',
      user: {
        id: fresh.id,
        name: fresh.name,
        email: fresh.email,
        role: fresh.role ?? DEFAULT_ROLE,
        email_verified: true
      },
      token: issueSessionToken(fresh)
    })
  }
}
