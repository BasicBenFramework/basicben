/**
 * Password reset, checked against the source.
 *
 * Two promises matter and both are easy to break with a well-meant edit: the
 * request endpoint never says whether an address has an account, and a reset
 * link never signs in an account that has a second factor. A helpful "no
 * account with that email" or an early return with a 429 breaks the first; a
 * reset that hands back a session unconditionally breaks the second.
 *
 * Exercised end to end against a scratch database as well: both an unknown
 * and a known address got byte-identical responses, and a reset ended a
 * session that had been valid a moment before.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf-8')

function method(source, name) {
  const start = source.indexOf(`async ${name}(`)
  assert.ok(start !== -1, `${name} should exist`)
  const next = source.indexOf('\n  async ', start + 1)
  return source.slice(start, next === -1 ? undefined : next)
}

const controller = read('src/controllers/PasswordResetController.ts')

describe('asking for a reset link', () => {
  const body = method(controller, 'request')

  test('is routed, and limited by address', () => {
    assert.match(
      read('src/routes/api/auth.ts'),
      /router\.post\('\/api\/auth\/forgot-password', passwordResetLimit, PasswordResetController\.request\)/
    )
  })

  test('answers every address the same way', () => {
    // One success response in the whole method, and it is the shared constant.
    const responses = [...body.matchAll(/res\.json\(([^)]*)\)/g)].map(([, args]) => args.trim())

    assert.deepStrictEqual(
      responses.filter((args) => !args.includes('422')),
      ['{ message: RESET_REQUESTED }'],
      'a second success shape is a way to tell accounts apart'
    )
  })

  test('never refuses based on the account', () => {
    assert.doesNotMatch(body, /404|429|User not found|No account/)
  })

  test('limits each mailbox silently, before looking the account up', () => {
    assert.match(body, /emailSendLimiter\.consume\(`password-reset:/)
    assert.ok(
      body.indexOf('emailSendLimiter.consume') < body.indexOf('User.findByEmail'),
      'consuming only for real accounts would make the limit an oracle'
    )
  })

  test('sends nothing to a disabled account', () => {
    assert.match(body, /!\(user as \{ disabled_at\?: string \| null \}\)\.disabled_at/)
  })

  test('a mail failure is swallowed into the same answer', () => {
    assert.match(body, /catch \(err\) \{\s*console\.error/)
  })

  test('issues a one-hour link and revokes the earlier ones', () => {
    assert.match(controller, /RESET_TTL = 60 \* 60 \* 1000/)
    assert.match(controller, /TOKEN_KINDS\.PASSWORD_RESET/)

    const send = controller.slice(controller.indexOf('async function sendResetEmail'))
    assert.ok(send.indexOf('revokeTokens(') < send.indexOf('issueToken('))
    assert.match(send, /\/reset-password\/\$\{token\}/)
  })

  test('uses a mail template of its own', () => {
    assert.match(controller, /renderMail\('password-reset'/)
    assert.ok(existsSync(join(ROOT, 'mail/password-reset.txt')))
    assert.ok(existsSync(join(ROOT, 'mail/password-reset.html')))
  })
})

describe('spending a reset link', () => {
  const body = method(controller, 'reset')

  test('is routed, and limited', () => {
    assert.match(
      read('src/routes/api/auth.ts'),
      /router\.post\('\/api\/auth\/reset-password', tokenRedeemLimit, PasswordResetController\.reset\)/
    )
  })

  test('requires eight characters and redeems atomically', () => {
    assert.match(body, /password: \[rules\.required, rules\.min\(8\)\]/)
    assert.match(body, /redeemToken\(token, TOKEN_KINDS\.PASSWORD_RESET\)/)
    assert.match(body, /hashPassword\(password\)/)
  })

  test('ends every session and verifies the address', () => {
    assert.match(body, /await revokeSessions\(user\.id\)/)
    assert.match(body, /email_verified: 1/)
  })

  test('does not sign in an account with a second factor', () => {
    const guard = body.indexOf('TwoFactor.isEnabled(twoFactor) || passkeyCount > 0')
    const session = body.indexOf('issueSessionToken(')

    assert.ok(guard !== -1, 'the second-factor check is missing')
    assert.ok(guard < session, 'a session is issued before the second factor is considered')
    assert.match(body.slice(guard, session), /signInRequired: true/)
  })

  test('the session it does issue is minted after the revocation', () => {
    // From the stale row it would carry the old token version and be dead on
    // arrival.
    assert.ok(body.indexOf('revokeSessions(') < body.indexOf('const fresh = '))
    assert.match(body, /issueSessionToken\(fresh\)/)
  })
})

describe('the reset pages', () => {
  const app = read('src/routes/App.tsx')
  const auth = app.slice(app.indexOf('const authRoutes'))

  test('are routed outside both build flags', () => {
    for (const route of ["'/forgot-password'", "'/reset-password/:token'"]) {
      assert.ok(auth.includes(route), `${route} should be in authRoutes`)
      assert.ok(
        auth.indexOf(route) < auth.indexOf('__DISABLE_REGISTRATION__'),
        `${route} should not depend on registration being open`
      )
    }
  })

  test('sign-in links to them', () => {
    assert.match(read('src/client/pages/Auth.tsx'), /navigate\('\/forgot-password'\)/)
  })

  test('a reset without a session goes to sign in', () => {
    const page = read('src/client/pages/ResetPassword.tsx')

    assert.match(page, /if \(data\.token && data\.user\)/)
    assert.match(page, /navigate\('\/login'\)/)
  })
})
