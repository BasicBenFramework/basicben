import { verifyPassword } from '@basicbenframework/core/auth'
import { issueToken, redeemToken, TOKEN_KINDS } from '@basicbenframework/core/auth/tokens'
import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistration,
  verifyAuthentication
} from '@basicbenframework/core/auth/webauthn'
import { User } from '../models/User'
import { Credential } from '../models/Credential'
import type { Request, Response } from '../types'

const CHALLENGE_TTL = 5 * 60 * 1000

/**
 * The relying party is the domain, not the origin.
 *
 * Passkeys are bound to it: a credential enrolled on example.com does not work
 * on app.example.com unless rpId was set to the parent. Changing this
 * invalidates every enrolled passkey, so decide it before anyone enrols.
 */
const rpId = () => process.env.WEBAUTHN_RP_ID || new URL(appUrl()).hostname
const rpName = () => process.env.SITE_NAME || 'BasicBen'
const appUrl = () => process.env.APP_URL || 'http://localhost:3000'

/** Origins a response may claim. */
const allowedOrigins = () =>
  (process.env.WEBAUTHN_ORIGINS || appUrl()).split(',').map((o) => o.trim()).filter(Boolean)

/**
 * Store a challenge server-side.
 *
 * This cannot be stateless. A challenge the client chooses is not a challenge —
 * the server must have issued it, and it must be usable once.
 */
async function issueChallenge(userId: number, challenge: string) {
  const { token } = await issueToken(userId, TOKEN_KINDS.WEBAUTHN_CHALLENGE, {
    ttl: CHALLENGE_TTL,
    metadata: { challenge }
  })
  return token
}

async function redeemChallenge(handle: string) {
  const redeemed = await redeemToken(handle, TOKEN_KINDS.WEBAUTHN_CHALLENGE)
  if (!redeemed) return null

  return {
    userId: redeemed.userId,
    challenge: (redeemed.metadata as { challenge?: string } | null)?.challenge
  }
}

async function confirmPassword(req: Request, res: Response) {
  const { password } = req.body as { password?: string }
  const user = await User.find(req.userId as number)

  if (!user) {
    res.json({ error: 'User not found' }, 404)
    return null
  }

  if (!password || !(await verifyPassword(password, user.password))) {
    res.json({ error: 'Your current password is required.' }, 403)
    return null
  }

  return user
}

export const PasskeyController = {
  /** Enrolled passkeys, for the account settings screen. */
  async list(req: Request, res: Response) {
    const credentials = await Credential.forUser(req.userId as number)

    return res.json({
      passkeys: credentials.map((c) => ({
        id: c.id,
        label: c.label,
        createdAt: c.created_at,
        lastUsedAt: c.last_used_at,
        backedUp: Boolean(c.backed_up)
      }))
    })
  },

  /** Options for navigator.credentials.create(). */
  async registerOptions(req: Request, res: Response) {
    const user = await confirmPassword(req, res)
    if (!user) return

    const existing = await Credential.forUser(user.id)

    const { options, challenge } = generateRegistrationOptions({
      rpId: rpId(),
      rpName: rpName(),
      user: {
        id: user.id,
        // An opaque handle rather than the row id: it is stored on the
        // authenticator and may be visible.
        handle: `user-${user.id}`,
        name: user.email,
        displayName: user.name
      },
      // Stops the same authenticator enrolling twice.
      excludeCredentials: existing.map((c) => ({ type: 'public-key', id: c.credential_id }))
    })

    const handle = await issueChallenge(user.id, challenge)

    return res.json({ options, challengeHandle: handle })
  },

  /** Verify and store a new passkey. */
  async registerVerify(req: Request, res: Response) {
    const { challengeHandle, response, label } = req.body as {
      challengeHandle?: string
      response?: {
        id: string
        response: { clientDataJSON: string; attestationObject: string }
      }
      label?: string
    }

    if (!response) {
      return res.json({ error: 'No credential was supplied.' }, 400)
    }

    const redeemed = await redeemChallenge(challengeHandle as string)
    // A redeemed token with no challenge in its metadata is as unusable as no
    // token at all — verifying against undefined would accept anything.
    if (!redeemed || redeemed.userId !== req.userId || !redeemed.challenge) {
      return res.json({ error: 'That enrolment attempt has expired. Please start again.' }, 400)
    }

    let result
    try {
      result = verifyRegistration({
        response,
        expectedChallenge: redeemed.challenge,
        expectedOrigin: allowedOrigins(),
        expectedRpId: rpId()
      })
    } catch (err) {
      return res.json({ error: (err as Error).message }, 400)
    }

    if (await Credential.findByCredentialId(result.credentialId)) {
      return res.json({ error: 'That passkey is already enrolled.' }, 409)
    }

    await Credential.create({
      user_id: req.userId,
      credential_id: result.credentialId,
      public_key: result.publicKey,
      algorithm: result.algorithm,
      sign_count: result.signCount,
      backed_up: result.backedUp ? 1 : 0,
      label: label || 'Passkey'
    })

    return res.json({ enrolled: true, credentialId: result.credentialId })
  },

  /**
   * Options for navigator.credentials.get(), as the second step of a login.
   *
   * Takes the 2FA challenge issued after a correct password, so it does not
   * reveal whether an account has passkeys to an unauthenticated caller.
   */
  async authenticateOptions(req: Request, res: Response) {
    const { challenge: loginChallenge } = req.body as { challenge?: string }

    // Peek rather than redeem: the login challenge is spent by /2fa/verify.
    const redeemed = await redeemToken(loginChallenge as string, TOKEN_KINDS.TWO_FACTOR_CHALLENGE)
    if (!redeemed) {
      return res.json({ error: 'That sign-in attempt has expired. Please start again.' }, 401)
    }

    const credentials = await Credential.forUser(redeemed.userId)
    if (credentials.length === 0) {
      return res.json({ error: 'No passkey is enrolled for this account.' }, 400)
    }

    const { options, challenge } = generateAuthenticationOptions({
      rpId: rpId(),
      allowCredentials: credentials.map((c) => ({ type: 'public-key', id: c.credential_id }))
    })

    // A fresh handle carrying both the webauthn challenge and the user, since
    // the login challenge has now been consumed.
    const handle = await issueChallenge(redeemed.userId, challenge)

    return res.json({ options, challengeHandle: handle })
  },

  /** Remove a passkey. */
  async remove(req: Request, res: Response) {
    const user = await confirmPassword(req, res)
    if (!user) return

    const removed = await Credential.delete(user.id, Number(req.params.id))

    if (!removed) {
      return res.json({ error: 'Passkey not found' }, 404)
    }

    return res.json({ removed: true })
  }
}

/**
 * Verify a passkey assertion as a second factor.
 *
 * Exported for TwoFactorController, which owns the verify endpoint — passkeys
 * are one method behind it rather than a separate login flow.
 */
export async function verifyPasskeyAssertion({
  challengeHandle,
  response
}: {
  challengeHandle?: string
  response?: Record<string, unknown>
}) {
  const redeemed = await redeemChallenge(challengeHandle as string)
  if (!redeemed?.challenge) return { ok: false as const, error: 'That sign-in attempt has expired.' }

  const presentedId = (response as { id?: string })?.id
  const credential = presentedId ? await Credential.findByCredentialId(presentedId) : undefined

  // The credential has to belong to the account that started this sign-in.
  if (!credential || credential.user_id !== redeemed.userId) {
    return { ok: false as const, error: 'That passkey is not enrolled for this account.' }
  }

  try {
    const result = verifyAuthentication({
      response,
      credential: {
        credentialId: credential.credential_id,
        publicKey: credential.public_key,
        signCount: credential.sign_count
      },
      expectedChallenge: redeemed.challenge,
      expectedOrigin: allowedOrigins(),
      expectedRpId: rpId()
    })

    await Credential.recordUse(credential.id, result.signCount)

    return { ok: true as const, userId: credential.user_id }
  } catch (err) {
    return { ok: false as const, error: (err as Error).message }
  }
}
