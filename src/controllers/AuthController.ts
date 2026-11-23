import { validate, rules } from '@basicbenframework/core/validation'
import { hashPassword, verifyPassword } from '@basicbenframework/core/auth'
import { ROLES, DEFAULT_ROLE } from '@basicbenframework/core/auth/permissions'
import { User } from '../models/User'
import { hooks, HOOKS } from '@basicbenframework/core/hooks'
import { sendVerificationEmail } from './EmailVerificationController'
import { issueChallenge } from './TwoFactorController'
import { TwoFactor } from '../models/TwoFactor'
import { Credential } from '../models/Credential'
import { loginByAddress, loginByAccount } from '../middleware/rate-limits'
import { issueSessionToken, revokeSessions } from '../helpers/session'
import { getDb } from '@basicbenframework/core/db'
import type { Request, Response } from '../types'

/**
 * A hash to check against when the address has no account.
 *
 * Without it a login for an unknown address returns before scrypt runs, and
 * the difference in response time says which addresses are registered.
 * Computed once, lazily, from a password nobody will ever send.
 */
let dummyHash: Promise<string> | null = null
function decoyHash(): Promise<string> {
  dummyHash ??= hashPassword('basicben-timing-decoy-' + Math.random())
  return dummyHash
}
// Computed at startup rather than on the first unknown address, which would
// otherwise pay for hashing twice and be the one slow response.
void decoyHash()

export const AuthController = {
  async register(req: Request, res: Response) {
    const result = await validate(req.body, {
      name: [rules.required, rules.string, rules.min(2)],
      email: [rules.required, rules.email],
      password: [rules.required, rules.min(8)]
    })

    if (result.fails()) {
      return res.json({ errors: result.errors }, 422)
    }

    const { name, email, password } = req.body as { name: string; email: string; password: string }

    // The first account to register is the operator setting the site up, so it
    // becomes the admin. Everyone after gets the least privileged role.
    const isFirstUser = (await User.count()) === 0

    // DISABLE_REGISTRATION closes the door behind that first account.
    //
    // It deliberately does not apply when there are no users at all. A fresh
    // deployment with the flag already set would otherwise have no way to
    // create its own admin — the flag would lock the operator out of the site
    // they are installing, which is a trap rather than a security measure.
    // Once one account exists the flag is absolute.
    //
    // Enforced here rather than in the router because the client hides the
    // form, and hiding a form is not a control.
    //
    // This runs *before* the address is looked up, and the order is the point.
    // Checking for a duplicate first would answer a question the caller has no
    // business asking: a taken address would come back "already registered"
    // while a free one came back "closed", turning an endpoint that refuses
    // everyone into a way to test which addresses have accounts.
    if (!isFirstUser && process.env.DISABLE_REGISTRATION === 'true') {
      return res.json({ error: 'Registration is closed' }, 403)
    }

    // Check if email exists
    const existing = await User.findByEmail(email)
    if (existing) {
      return res.json({ error: 'Email already registered' }, 400)
    }

    const role = isFirstUser ? ROLES.ADMIN : DEFAULT_ROLE

    // The first account is the operator setting the site up, and on a fresh
    // install mail is very likely unconfigured. Requiring them to click a link
    // that was never delivered would lock them out of their own admin.
    const emailVerified = isFirstUser

    let user = await User.create({
      name,
      email,
      password: await hashPassword(password),
      role,
      email_verified: emailVerified ? 1 : 0,
      email_verified_at: emailVerified ? new Date().toISOString() : null
    })

    // "First" was decided by a count taken before the insert, so two signups
    // racing on a fresh install could both see zero and both become admin.
    // Only the lowest id keeps it; anyone else who raced is demoted on the spot.
    if (isFirstUser) {
      const db = await getDb()
      const first = await db.get('SELECT MIN(id) AS id FROM users')
      if (Number(first?.id) !== Number(user.id)) {
        user = await User.update(user.id, { role: DEFAULT_ROLE, email_verified: 0, email_verified_at: null })
        return res.json({ error: 'Registration conflicted with another signup. Please sign in.' }, 409)
      }
    }

    let verificationSent = false

    if (!emailVerified) {
      // A provider outage must not fail the registration. The account exists
      // either way, so returning 500 here would leave the caller believing it
      // does not; the flag lets the client offer a resend instead.
      try {
        await sendVerificationEmail(user)
        verificationSent = true
      } catch (err) {
        console.error('Failed to send verification email:', (err as Error).message)
      }
    }

    const token = issueSessionToken({ id: user.id, role, email_verified: emailVerified, token_version: 0 })

    await hooks.fire(HOOKS.AUTH_REGISTER, { user, role, verificationSent })

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role,
        email_verified: emailVerified
      },
      token,
      verificationSent
    })
  },

  async login(req: Request, res: Response) {
    const { email, password } = req.body as { email?: string; password?: string }

    if (!email || !password) {
      return res.json({ error: 'Email and password required' }, 400)
    }

    const user = await User.findByEmail(email)
    if (!user) {
      // Same work as a wrong password, so the two cannot be told apart by time.
      await verifyPassword(password, await decoyHash())
      return res.json({ error: 'Invalid credentials' }, 401)
    }
    if (!(await verifyPassword(password, user.password))) {
      return res.json({ error: 'Invalid credentials' }, 401)
    }

    // Checked only after the password, so a disabled account is not revealed
    // to someone who does not know its password.
    if ((user as { disabled_at?: string | null }).disabled_at) {
      return res.json({ error: 'This account has been disabled.' }, 403)
    }

    // With a second factor enrolled the password alone is not a session. The
    // caller gets a challenge to exchange at /api/auth/2fa/verify instead.
    // The password was correct, so this attempt should not count against the
    // guess allowance.
    await (loginByAddress as any).limiter.reset((loginByAddress as any).key(req))
    await (loginByAccount as any).limiter.reset((loginByAccount as any).key(req))

    const twoFactor = await TwoFactor.find(user.id)
    const passkeyCount = await Credential.countForUser(user.id)

    if (TwoFactor.isEnabled(twoFactor) || passkeyCount > 0) {
      const { challenge, expiresAt } = await issueChallenge(user.id)

      const methods: string[] = []
      if (passkeyCount > 0) methods.push('passkey')
      if (TwoFactor.isEnabled(twoFactor)) methods.push('totp', 'recovery')

      return res.json({ twoFactorRequired: true, methods, challenge, expiresAt })
    }

    const token = issueSessionToken(user)

    await hooks.fire(HOOKS.AUTH_LOGIN, { user, req })

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role ?? DEFAULT_ROLE,
        email_verified: Boolean(user.email_verified)
      },
      token
    })
  },

  /**
   * Sign out, everywhere.
   *
   * Bumps the account's token version, so this token and every other one the
   * account holds stop working on their next request. A stateless token cannot
   * be revoked one at a time without a denylist; ending them all is the
   * conservative choice for an admin account.
   */
  async logout(req: Request, res: Response) {
    await revokeSessions(req.userId!)

    await hooks.fire(HOOKS.AUTH_LOGOUT, { userId: req.userId, req })

    res.json({ message: 'Signed out.' })
  },

  async user(req: Request, res: Response) {
    const user = await User.find(req.userId!)
    if (!user) {
      return res.json({ error: 'User not found' }, 404)
    }

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role ?? DEFAULT_ROLE,
        email_verified: Boolean(user.email_verified)
      }
    })
  }
}
