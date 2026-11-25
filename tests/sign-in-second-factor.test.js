/**
 * The sign-in page finishes a login that needs a second factor.
 *
 * With an authenticator app or a passkey enrolled, a correct password answers
 * `{ twoFactorRequired, methods, challenge }` rather than a token. The page
 * used to store `data.token` regardless — undefined — so anyone who turned on
 * two-step verification could no longer sign in to the admin.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf-8')

test('a challenge is taken to the second step, not stored as a session', () => {
  const auth = read('src/client/pages/Auth.tsx')
  const branch = auth.indexOf("'twoFactorRequired' in data")
  assert.ok(branch !== -1, 'the login answer is checked for twoFactorRequired')
  assert.ok(branch < auth.indexOf('finish(data, isLogin'), 'before anything is stored')
  assert.match(auth, /localStorage\.setItem\('token', data\.token\)/)
})

test('codes and passkeys are both exchanged at /api/auth/2fa/verify', () => {
  const auth = read('src/client/pages/Auth.tsx')
  assert.match(auth, /\/api\/auth\/2fa\/verify[\s\S]*challenge: second\.challenge, code/)
  assert.match(auth, /\/api\/auth\/passkey\/options[\s\S]*\/api\/auth\/2fa\/verify[\s\S]*challengeHandle, response/)
})

test('Profile can enrol both factors', () => {
  const card = read('src/client/components/admin/SecurityCard.tsx')
  for (const route of ['/api/auth/2fa/totp/setup', '/api/auth/2fa/totp/confirm', '/api/auth/2fa/recovery/rotate', '/api/auth/passkeys/options', '/api/auth/passkeys/verify']) {
    assert.ok(card.includes(route), route)
  }
  assert.match(read('src/client/pages/Profile.tsx'), /<SecurityCard \/>/)
})

test('a wrong code hands back a fresh challenge, so a typo is not a restart', () => {
  const controller = read('src/controllers/TwoFactorController.ts')
  assert.match(controller, /const next = await issueChallenge\(user\.id\)\s*\n\s*return res\.json\(\{ error: 'That code is not right\.', \.\.\.next \}, 401\)/)
  const auth = read('src/client/pages/Auth.tsx')
  assert.match(auth, /if \(data\.challenge\) \{\s*\n\s*setSecond\(\{ \.\.\.second, challenge: data\.challenge \}\)/)
})
