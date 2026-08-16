import { sendMail, renderMail } from '@basicbenframework/core/mail'
import { issueToken, redeemToken, revokeTokens, hasRecentToken, TOKEN_KINDS } from '@basicbenframework/core/auth/tokens'
import { User } from '../models/User.js'

// One verification email per user per five minutes. The framework has no rate
// limiter, and this endpoint sends mail on demand to any authenticated caller,
// so the token table doubles as the cooldown.
const RESEND_COOLDOWN = 5 * 60 * 1000

const appUrl = () => process.env.APP_URL || 'http://localhost:3000'

/**
 * Issue a token and email the link. Registration sends the first one.
 */
export async function sendVerificationEmail(user) {
  const { token } = await issueToken(user.id, TOKEN_KINDS.EMAIL_VERIFICATION, {
    metadata: { email: user.email }
  })

  const verifyUrl = `${appUrl()}/verify/${token}`

  const body = renderMail('verify-email', {
    name: user.name,
    siteName: process.env.SITE_NAME || 'BasicBen',
    verifyUrl
  })

  await sendMail({ to: user.email, subject: 'Confirm your email address', ...body })

  return verifyUrl
}

export const EmailVerificationController = {
  /**
   * Redeem a token from the emailed link.
   *
   * A link target rather than an API call, so it redirects into the app with
   * the outcome instead of returning JSON.
   */
  async verify(req, res) {
    const result = await redeemToken(req.params.token, TOKEN_KINDS.EMAIL_VERIFICATION)
    if (!result) return res.redirect(`${appUrl()}/verify/failed`)

    const user = await User.find(result.userId)
    if (!user) return res.redirect(`${appUrl()}/verify/failed`)

    // Only verify if the address still matches the one the link was issued for,
    // or changing your email afterwards would verify an address nobody proved.
    if (result.metadata?.email && result.metadata.email !== user.email) {
      return res.redirect(`${appUrl()}/verify/failed`)
    }

    await User.update(user.id, {
      email_verified: 1,
      email_verified_at: new Date().toISOString()
    })

    return res.redirect(`${appUrl()}/verify/success`)
  },

  async resend(req, res) {
    const user = await User.find(req.userId)
    if (!user) return res.json({ error: 'User not found' }, 404)

    if (user.email_verified) {
      return res.json({ message: 'Your email is already verified.' })
    }

    if (await hasRecentToken(user.id, TOKEN_KINDS.EMAIL_VERIFICATION, RESEND_COOLDOWN)) {
      return res.json(
        { error: 'A verification email was sent recently. Please check your inbox, or try again in a few minutes.' },
        429
      )
    }

    try {
      await sendVerificationEmail(user)
    } catch (err) {
      console.error('Failed to send verification email:', err.message)
      return res.json({ error: 'Could not send the email. Please try again shortly.' }, 502)
    }

    return res.json({ message: 'Verification email sent.' })
  },

  async status(req, res) {
    const user = await User.find(req.userId)
    if (!user) return res.json({ error: 'User not found' }, 404)

    return res.json({
      email: user.email,
      verified: Boolean(user.email_verified),
      verifiedAt: user.email_verified_at ?? null
    })
  }
}

/**
 * Invalidate outstanding links when the address changes.
 */
export async function resetVerification(userId) {
  await revokeTokens(userId, TOKEN_KINDS.EMAIL_VERIFICATION)
  await User.update(userId, { email_verified: 0, email_verified_at: null })
}
