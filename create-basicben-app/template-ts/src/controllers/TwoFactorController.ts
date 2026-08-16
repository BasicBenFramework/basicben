import { signJwt, verifyPassword } from '@basicbenframework/core/auth'
import { DEFAULT_ROLE } from '@basicbenframework/core/auth/permissions'
import { issueToken, redeemToken, TOKEN_KINDS } from '@basicbenframework/core/auth/tokens'
import {
  generateSecret,
  verifyTotp,
  otpauthUri,
  encryptSecret,
  decryptSecret
} from '@basicbenframework/core/auth/totp'
import {
  generateRecoveryCodes,
  hashRecoveryCodes,
  findRecoveryCode,
  lockoutState,
  registerFailure
} from '@basicbenframework/core/auth/two-factor'
import { User } from '../models/User'
import { verifyPasskeyAssertion } from './PasskeyController'
import { TwoFactor } from '../models/TwoFactor'
import type { Request, Response } from '../types'

// A challenge is the only thing standing between a correct password and a
// session, so it is short-lived and single use.
const CHALLENGE_TTL = 5 * 60 * 1000

const issuer = () => process.env.SITE_NAME || 'BasicBen'

/**
 * Start the second step of a login.
 *
 * Returns an opaque challenge rather than a session token. It lives in
 * auth_tokens, never as a JWT, so verifyJwt cannot return one and it can never
 * be mistaken for a session — which would bypass the second factor entirely.
 */
export async function issueChallenge(userId: number) {
  const { token, expiresAt } = await issueToken(userId, TOKEN_KINDS.TWO_FACTOR_CHALLENGE, {
    ttl: CHALLENGE_TTL
  })

  return { challenge: token, expiresAt }
}

/** Mint the real session once a second factor has been satisfied. */
function sessionFor(user: { id: number; name: string; email: string; role?: string; email_verified?: number }) {
  const role = user.role ?? DEFAULT_ROLE
  const emailVerified = Boolean(user.email_verified)

  return {
    token: signJwt(
      { userId: user.id, role, email_verified: emailVerified },
      process.env.APP_KEY as string,
      { expiresIn: '7d' }
    ),
    user: { id: user.id, name: user.name, email: user.email, role, email_verified: emailVerified }
  }
}

/**
 * Enrolling or removing a factor is a credential change, so it needs the
 * password even though the caller is already signed in. Without this a stolen
 * session becomes permanent account takeover: the attacker enrols their own
 * factor and locks the owner out.
 */
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

export const TwoFactorController = {
  /** What is enrolled, for the account settings screen. */
  async status(req: Request, res: Response) {
    const record = await TwoFactor.find(req.userId as number)

    return res.json({
      totp: {
        enabled: TwoFactor.isEnabled(record),
        enabledAt: record?.totp_enabled_at ?? null
      },
      recoveryCodesRemaining: TwoFactor.parseRecoveryCodes(record).length
    })
  },

  /**
   * Generate a secret. Deliberately does not enable anything — enrolment is
   * only complete once a working code proves the authenticator was configured.
   */
  async setupTotp(req: Request, res: Response) {
    const user = await confirmPassword(req, res)
    if (!user) return

    const existing = await TwoFactor.find(user.id)
    if (TwoFactor.isEnabled(existing)) {
      return res.json({ error: 'An authenticator app is already enrolled. Remove it first.' }, 409)
    }

    const secret = generateSecret()

    await TwoFactor.findOrCreate(user.id)
    await TwoFactor.update(user.id, {
      totp_secret: encryptSecret(secret),
      totp_enabled_at: null,
      totp_last_step: null
    })

    // The URI is returned rather than a QR image: rendering one is the client's
    // job, and it keeps the secret out of anything the server might cache.
    return res.json({
      secret,
      uri: otpauthUri({ secret, label: user.email, issuer: issuer() })
    })
  },

  /** Confirm the authenticator works, then enable and hand over recovery codes. */
  async confirmTotp(req: Request, res: Response) {
    const { code } = req.body as { code?: string }
    const record = await TwoFactor.find(req.userId as number)

    if (!record?.totp_secret) {
      return res.json({ error: 'Start by generating a secret.' }, 400)
    }

    if (record.totp_enabled_at) {
      return res.json({ error: 'An authenticator app is already enrolled.' }, 409)
    }

    const secret = decryptSecret(record.totp_secret)
    if (!secret) {
      return res.json({ error: 'The stored secret could not be read. Start again.' }, 500)
    }

    const result = verifyTotp(secret, code as string, { lastStep: record.totp_last_step })
    if (!result.valid) {
      return res.json({ error: 'That code is not right. Check your authenticator app.' }, 400)
    }

    const codes = generateRecoveryCodes()

    await TwoFactor.update(req.userId as number, {
      totp_enabled_at: new Date().toISOString(),
      totp_last_step: result.step,
      recovery_codes: JSON.stringify(await hashRecoveryCodes(codes)),
      failed_attempts: 0,
      locked_until: null
    })

    // Shown exactly once. They are hashed, so they cannot be shown again.
    return res.json({
      enabled: true,
      recoveryCodes: codes
    })
  },

  /** Remove the authenticator. */
  async disableTotp(req: Request, res: Response) {
    const user = await confirmPassword(req, res)
    if (!user) return

    await TwoFactor.delete(user.id)

    return res.json({ enabled: false })
  },

  /** Replace the recovery codes, invalidating the old set. */
  async rotateRecoveryCodes(req: Request, res: Response) {
    const user = await confirmPassword(req, res)
    if (!user) return

    const record = await TwoFactor.find(user.id)
    if (!TwoFactor.isEnabled(record)) {
      return res.json({ error: 'No second factor is enrolled.' }, 400)
    }

    const codes = generateRecoveryCodes()
    await TwoFactor.update(user.id, { recovery_codes: JSON.stringify(await hashRecoveryCodes(codes)) })

    return res.json({ recoveryCodes: codes })
  },

  /**
   * The second step of a login: exchange a challenge plus a code for a session.
   */
  async verify(req: Request, res: Response) {
    const { challenge, code, challengeHandle, response } = req.body as {
      challenge?: string
      code?: string
      challengeHandle?: string
      response?: Record<string, unknown>
    }

    // A passkey is one method behind this endpoint rather than a separate login
    // flow, so a third factor would slot in the same way.
    if (challengeHandle && response) {
      const result = await verifyPasskeyAssertion({ challengeHandle, response })

      if (!result.ok) {
        return res.json({ error: result.error }, 401)
      }

      const passkeyUser = await User.find(result.userId)
      if (!passkeyUser) {
        return res.json({ error: 'That sign-in attempt has expired. Please start again.' }, 401)
      }

      return res.json(sessionFor(passkeyUser))
    }

    const redeemed = await redeemToken(challenge as string, TOKEN_KINDS.TWO_FACTOR_CHALLENGE)
    if (!redeemed) {
      return res.json({ error: 'That sign-in attempt has expired. Please start again.' }, 401)
    }

    const user = await User.find(redeemed.userId)
    const record = await TwoFactor.find(redeemed.userId)

    if (!user || !TwoFactor.isEnabled(record)) {
      return res.json({ error: 'That sign-in attempt has expired. Please start again.' }, 401)
    }

    // Five tries against a million possibilities is the entire security
    // argument for a six-digit code, so the lock is not optional.
    const lock = lockoutState(record)
    if (lock.locked) {
      return res.json(
        { error: 'Too many incorrect codes. Try again shortly.', retryAfter: lock.retryAfter },
        429
      )
    }

    const secret = decryptSecret(record!.totp_secret as string)
    const result = secret
      ? verifyTotp(secret, code as string, { lastStep: record!.totp_last_step })
      : { valid: false, step: null }

    if (result.valid) {
      await TwoFactor.update(user.id, {
        totp_last_step: result.step,
        failed_attempts: 0,
        locked_until: null
      })
      return res.json(sessionFor(user))
    }

    // A recovery code is a full second factor, for when the phone is gone.
    const hashes = TwoFactor.parseRecoveryCodes(record)
    const index = await findRecoveryCode(code as string, hashes)

    if (index !== -1) {
      hashes.splice(index, 1) // single use
      await TwoFactor.update(user.id, {
        recovery_codes: JSON.stringify(hashes),
        failed_attempts: 0,
        locked_until: null
      })

      return res.json({ ...sessionFor(user), recoveryCodeUsed: true, recoveryCodesRemaining: hashes.length })
    }

    const failure = registerFailure(record!)
    await TwoFactor.update(user.id, {
      failed_attempts: failure.failedAttempts,
      locked_until: failure.lockedUntil
    })

    if (failure.locked) {
      return res.json({ error: 'Too many incorrect codes. Try again shortly.' }, 429)
    }

    return res.json({ error: 'That code is not right.' }, 401)
  }
}
