/**
 * Token store tests.
 *
 * Run against a real SQLite database rather than a stub, because the properties
 * worth asserting are about storage: that the plaintext is never written, that
 * a token cannot be redeemed twice, and that expiry is honoured.
 */

import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb, resetDb } from '../db/index.js'
import {
  issueToken,
  redeemToken,
  revokeTokens,
  hasRecentToken,
  pruneExpiredTokens,
  hashToken,
  TOKEN_KINDS
} from './tokens.js'

let dir
let previousUrl

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'basicben-tokens-'))
  previousUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = join(dir, 'tokens.db')
  resetDb()
})

after(async () => {
  const db = await getDb()
  await db.close()
  resetDb()
  if (previousUrl === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = previousUrl
  rmSync(dir, { recursive: true, force: true })
})

beforeEach(async () => {
  const db = await getDb()
  await db.exec('DROP TABLE IF EXISTS auth_tokens')
  await db.exec(`
    CREATE TABLE auth_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      metadata TEXT,
      expires_at DATETIME NOT NULL,
      used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
})

describe('issuing', () => {
  test('returns a plaintext token and an expiry', async () => {
    const { token, expiresAt } = await issueToken(1, TOKEN_KINDS.EMAIL_VERIFICATION)

    assert.strictEqual(typeof token, 'string')
    assert.ok(token.length >= 40, 'a 32-byte token is long enough to be unguessable')
    assert.ok(expiresAt > new Date())
  })

  test('stores only the hash, never the token', async () => {
    const { token } = await issueToken(1, TOKEN_KINDS.EMAIL_VERIFICATION)

    const db = await getDb()
    const row = await db.get('SELECT token_hash FROM auth_tokens WHERE user_id = 1')

    assert.strictEqual(row.token_hash, hashToken(token))
    assert.notStrictEqual(row.token_hash, token)

    // Nothing anywhere in the row should contain the plaintext.
    const all = await db.all('SELECT * FROM auth_tokens')
    assert.ok(!JSON.stringify(all).includes(token), 'the plaintext must not be stored')
  })

  test('two tokens are never the same', async () => {
    const a = await issueToken(1, TOKEN_KINDS.EMAIL_VERIFICATION)
    const b = await issueToken(1, TOKEN_KINDS.EMAIL_VERIFICATION)

    assert.notStrictEqual(a.token, b.token)
  })

  test('carries metadata', async () => {
    const { token } = await issueToken(7, TOKEN_KINDS.EMAIL_VERIFICATION, {
      metadata: { email: 'ada@example.com' }
    })

    const redeemed = await redeemToken(token, TOKEN_KINDS.EMAIL_VERIFICATION)
    assert.deepStrictEqual(redeemed.metadata, { email: 'ada@example.com' })
  })
})

describe('redeeming', () => {
  test('returns the user it was issued for', async () => {
    const { token } = await issueToken(42, TOKEN_KINDS.EMAIL_VERIFICATION)

    const result = await redeemToken(token, TOKEN_KINDS.EMAIL_VERIFICATION)

    assert.strictEqual(result.userId, 42)
  })

  test('a token works exactly once', async () => {
    const { token } = await issueToken(1, TOKEN_KINDS.EMAIL_VERIFICATION)

    assert.ok(await redeemToken(token, TOKEN_KINDS.EMAIL_VERIFICATION))
    assert.strictEqual(await redeemToken(token, TOKEN_KINDS.EMAIL_VERIFICATION), null)
  })

  test('concurrent redemptions cannot both succeed', async () => {
    const { token } = await issueToken(1, TOKEN_KINDS.EMAIL_VERIFICATION)

    const results = await Promise.all([
      redeemToken(token, TOKEN_KINDS.EMAIL_VERIFICATION),
      redeemToken(token, TOKEN_KINDS.EMAIL_VERIFICATION)
    ])

    assert.strictEqual(results.filter(Boolean).length, 1, 'exactly one may win')
  })

  test('the wrong kind does not redeem it', async () => {
    const { token } = await issueToken(1, TOKEN_KINDS.EMAIL_VERIFICATION)

    assert.strictEqual(await redeemToken(token, TOKEN_KINDS.PASSWORD_RESET), null)
    // and it is still unused
    assert.ok(await redeemToken(token, TOKEN_KINDS.EMAIL_VERIFICATION))
  })

  test('an expired token is refused', async () => {
    const { token } = await issueToken(1, TOKEN_KINDS.EMAIL_VERIFICATION, { ttl: -1000 })

    assert.strictEqual(await redeemToken(token, TOKEN_KINDS.EMAIL_VERIFICATION), null)
  })

  test('an unknown token is refused', async () => {
    assert.strictEqual(await redeemToken('not-a-real-token', TOKEN_KINDS.EMAIL_VERIFICATION), null)
  })

  test('empty input is refused rather than throwing', async () => {
    assert.strictEqual(await redeemToken('', TOKEN_KINDS.EMAIL_VERIFICATION), null)
    assert.strictEqual(await redeemToken(null, TOKEN_KINDS.EMAIL_VERIFICATION), null)
    assert.strictEqual(await redeemToken(undefined, TOKEN_KINDS.EMAIL_VERIFICATION), null)
  })
})

describe('revoking', () => {
  test('invalidates every outstanding token for a user', async () => {
    const a = await issueToken(1, TOKEN_KINDS.EMAIL_VERIFICATION)
    const b = await issueToken(1, TOKEN_KINDS.EMAIL_VERIFICATION)

    const revoked = await revokeTokens(1, TOKEN_KINDS.EMAIL_VERIFICATION)

    assert.strictEqual(revoked, 2)
    assert.strictEqual(await redeemToken(a.token, TOKEN_KINDS.EMAIL_VERIFICATION), null)
    assert.strictEqual(await redeemToken(b.token, TOKEN_KINDS.EMAIL_VERIFICATION), null)
  })

  test('leaves other users and other kinds alone', async () => {
    const mine = await issueToken(1, TOKEN_KINDS.EMAIL_VERIFICATION)
    const theirs = await issueToken(2, TOKEN_KINDS.EMAIL_VERIFICATION)
    const reset = await issueToken(1, TOKEN_KINDS.PASSWORD_RESET)

    await revokeTokens(1, TOKEN_KINDS.EMAIL_VERIFICATION)

    assert.strictEqual(await redeemToken(mine.token, TOKEN_KINDS.EMAIL_VERIFICATION), null)
    assert.ok(await redeemToken(theirs.token, TOKEN_KINDS.EMAIL_VERIFICATION))
    assert.ok(await redeemToken(reset.token, TOKEN_KINDS.PASSWORD_RESET))
  })
})

describe('resend cooldown', () => {
  test('reports a token issued within the window', async () => {
    await issueToken(1, TOKEN_KINDS.EMAIL_VERIFICATION)

    assert.strictEqual(await hasRecentToken(1, TOKEN_KINDS.EMAIL_VERIFICATION, 60_000), true)
  })

  test('reports nothing for a different user', async () => {
    await issueToken(1, TOKEN_KINDS.EMAIL_VERIFICATION)

    assert.strictEqual(await hasRecentToken(2, TOKEN_KINDS.EMAIL_VERIFICATION, 60_000), false)
  })

  test('a redeemed token no longer blocks a resend', async () => {
    const { token } = await issueToken(1, TOKEN_KINDS.EMAIL_VERIFICATION)
    await redeemToken(token, TOKEN_KINDS.EMAIL_VERIFICATION)

    assert.strictEqual(await hasRecentToken(1, TOKEN_KINDS.EMAIL_VERIFICATION, 60_000), false)
  })
})

describe('pruning', () => {
  test('removes expired rows and keeps live ones', async () => {
    await issueToken(1, TOKEN_KINDS.EMAIL_VERIFICATION, { ttl: -1000 })
    await issueToken(2, TOKEN_KINDS.EMAIL_VERIFICATION, { ttl: 60_000 })

    const deleted = await pruneExpiredTokens()

    const db = await getDb()
    const remaining = await db.all('SELECT user_id FROM auth_tokens')

    assert.strictEqual(deleted, 1)
    assert.deepStrictEqual(remaining.map((r) => r.user_id), [2])
  })

  test('removes used rows too', async () => {
    const { token } = await issueToken(1, TOKEN_KINDS.EMAIL_VERIFICATION)
    await redeemToken(token, TOKEN_KINDS.EMAIL_VERIFICATION)

    await pruneExpiredTokens()

    const db = await getDb()
    assert.strictEqual((await db.all('SELECT * FROM auth_tokens')).length, 0)
  })
})
