/**
 * API token tests.
 *
 * Run against a real SQLite database rather than a stub, because the properties
 * worth asserting are about storage: that the plaintext is never written, that
 * expiry and scopes are honoured, and that one user cannot revoke another's
 * token.
 */

import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb, resetDb } from '../db/index.js'
import {
  createApiToken,
  verifyApiToken,
  listApiTokens,
  revokeApiToken,
  revokeAllApiTokens,
  pruneExpiredApiTokens,
  hashApiToken,
  isApiToken,
  hasScope,
  SCOPES,
  TOKEN_PREFIX
} from './api-tokens.js'

let dir
let previousUrl

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'basicben-api-tokens-'))
  previousUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = join(dir, 'api-tokens.db')
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
  await db.exec('DROP TABLE IF EXISTS api_tokens')
  await db.exec(`
    CREATE TABLE api_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      scopes TEXT NOT NULL,
      last_used_at TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL
    )
  `)
})

describe('createApiToken', () => {
  test('returns a prefixed plaintext and stores only its hash', async () => {
    const { token } = await createApiToken(1, {
      name: 'Static site build',
      scopes: [SCOPES.CONTENT_READ]
    })

    assert.ok(token.startsWith(TOKEN_PREFIX), `expected a ${TOKEN_PREFIX} prefix, got ${token}`)

    const db = await getDb()
    const row = await db.get('SELECT token_hash FROM api_tokens WHERE user_id = 1')

    assert.strictEqual(row.token_hash, hashApiToken(token))
    assert.notStrictEqual(row.token_hash, token)

    // The plaintext must appear nowhere in the row, not just in token_hash.
    const full = await db.get('SELECT * FROM api_tokens WHERE user_id = 1')
    assert.ok(!JSON.stringify(full).includes(token), 'the plaintext was stored somewhere')
  })

  test('issues a distinct token every time', async () => {
    const a = await createApiToken(1, { name: 'one', scopes: [SCOPES.CONTENT_READ] })
    const b = await createApiToken(1, { name: 'two', scopes: [SCOPES.CONTENT_READ] })

    assert.notStrictEqual(a.token, b.token)
  })

  test('refuses an unknown scope', async () => {
    await assert.rejects(
      () => createApiToken(1, { name: 'typo', scopes: ['content:reed'] }),
      /Unknown scope: content:reed/
    )
  })

  test('refuses no scopes', async () => {
    await assert.rejects(
      () => createApiToken(1, { name: 'empty', scopes: [] }),
      /at least one scope/
    )
  })

  test('refuses a nameless token', async () => {
    await assert.rejects(
      () => createApiToken(1, { name: '   ', scopes: [SCOPES.CONTENT_READ] }),
      /needs a name/
    )
  })

  test('de-duplicates scopes', async () => {
    const { scopes } = await createApiToken(1, {
      name: 'dupes',
      scopes: [SCOPES.CONTENT_READ, SCOPES.CONTENT_READ]
    })

    assert.deepStrictEqual(scopes, [SCOPES.CONTENT_READ])
  })
})

describe('verifyApiToken', () => {
  test('accepts a valid token and returns its owner', async () => {
    const { token, id } = await createApiToken(7, {
      name: 'valid',
      scopes: [SCOPES.CONTENT_READ]
    })

    const result = await verifyApiToken(token)

    assert.strictEqual(result.userId, 7)
    assert.strictEqual(result.id, id)
    assert.strictEqual(result.name, 'valid')
    assert.deepStrictEqual(result.scopes, [SCOPES.CONTENT_READ])
  })

  test('refuses an unknown token', async () => {
    assert.strictEqual(await verifyApiToken(`${TOKEN_PREFIX}nothing`), null)
  })

  test('refuses a JWT-shaped string without touching the database', async () => {
    assert.strictEqual(await verifyApiToken('eyJhbGciOiJIUzI1NiJ9.e30.abc'), null)
    assert.strictEqual(await verifyApiToken(''), null)
    assert.strictEqual(await verifyApiToken(null), null)
  })

  test('refuses an expired token', async () => {
    const { token } = await createApiToken(1, {
      name: 'expired',
      scopes: [SCOPES.CONTENT_READ],
      ttl: -1000
    })

    assert.strictEqual(await verifyApiToken(token), null)
  })

  test('honours a required scope', async () => {
    const { token } = await createApiToken(1, {
      name: 'read only',
      scopes: [SCOPES.CONTENT_READ]
    })

    assert.ok(await verifyApiToken(token, SCOPES.CONTENT_READ))
    assert.strictEqual(await verifyApiToken(token, SCOPES.CONTENT_WRITE), null)
  })

  test('a write scope grants the matching read', async () => {
    const { token } = await createApiToken(1, {
      name: 'writer',
      scopes: [SCOPES.CONTENT_WRITE]
    })

    assert.ok(await verifyApiToken(token, SCOPES.CONTENT_READ))
    // But not across resources.
    assert.strictEqual(await verifyApiToken(token, SCOPES.MEDIA_READ), null)
  })

  test('records last use', async () => {
    const { token, id } = await createApiToken(1, {
      name: 'tracked',
      scopes: [SCOPES.CONTENT_READ]
    })

    const db = await getDb()
    const before = await db.get('SELECT last_used_at FROM api_tokens WHERE id = ?', [id])
    assert.strictEqual(before.last_used_at, null)

    await verifyApiToken(token)

    const after = await db.get('SELECT last_used_at FROM api_tokens WHERE id = ?', [id])
    assert.ok(after.last_used_at, 'last_used_at was never written')
  })

  test('does not rewrite last use on every call', async () => {
    // A write per request on a read-heavy public API is the thing being avoided,
    // so assert the throttle rather than just the write.
    const { token, id } = await createApiToken(1, {
      name: 'throttled',
      scopes: [SCOPES.CONTENT_READ]
    })

    await verifyApiToken(token)

    const db = await getDb()
    const first = await db.get('SELECT last_used_at FROM api_tokens WHERE id = ?', [id])

    await verifyApiToken(token)
    await verifyApiToken(token)

    const last = await db.get('SELECT last_used_at FROM api_tokens WHERE id = ?', [id])
    assert.strictEqual(last.last_used_at, first.last_used_at)
  })
})

describe('listApiTokens', () => {
  test('returns tokens without the hash or plaintext', async () => {
    const { token } = await createApiToken(3, {
      name: 'listed',
      scopes: [SCOPES.CONTENT_READ, SCOPES.MEDIA_READ]
    })

    const [entry] = await listApiTokens(3)

    assert.strictEqual(entry.name, 'listed')
    assert.deepStrictEqual(entry.scopes, [SCOPES.CONTENT_READ, SCOPES.MEDIA_READ])

    const serialized = JSON.stringify(entry)
    assert.ok(!serialized.includes(token), 'the plaintext leaked into the listing')
    assert.ok(!serialized.includes(hashApiToken(token)), 'the hash leaked into the listing')
  })

  test('only returns the given user\'s tokens', async () => {
    await createApiToken(1, { name: 'mine', scopes: [SCOPES.CONTENT_READ] })
    await createApiToken(2, { name: 'theirs', scopes: [SCOPES.CONTENT_READ] })

    const mine = await listApiTokens(1)

    assert.strictEqual(mine.length, 1)
    assert.strictEqual(mine[0].name, 'mine')
  })
})

describe('revokeApiToken', () => {
  test('a revoked token stops verifying', async () => {
    const { token, id } = await createApiToken(1, {
      name: 'doomed',
      scopes: [SCOPES.CONTENT_READ]
    })

    assert.ok(await verifyApiToken(token))
    assert.strictEqual(await revokeApiToken(id, 1), true)
    assert.strictEqual(await verifyApiToken(token), null)
  })

  test('one user cannot revoke another\'s token', async () => {
    const { token, id } = await createApiToken(1, {
      name: 'not yours',
      scopes: [SCOPES.CONTENT_READ]
    })

    assert.strictEqual(await revokeApiToken(id, 2), false)
    assert.ok(await verifyApiToken(token), 'the token was revoked by the wrong user')
  })

  test('revokeAll clears only that user', async () => {
    await createApiToken(1, { name: 'a', scopes: [SCOPES.CONTENT_READ] })
    await createApiToken(1, { name: 'b', scopes: [SCOPES.CONTENT_READ] })
    const other = await createApiToken(2, { name: 'c', scopes: [SCOPES.CONTENT_READ] })

    assert.strictEqual(await revokeAllApiTokens(1), 2)
    assert.strictEqual((await listApiTokens(1)).length, 0)
    assert.ok(await verifyApiToken(other.token))
  })
})

describe('pruneExpiredApiTokens', () => {
  test('deletes expired rows and leaves live ones', async () => {
    await createApiToken(1, { name: 'dead', scopes: [SCOPES.CONTENT_READ], ttl: -1000 })
    const live = await createApiToken(1, { name: 'live', scopes: [SCOPES.CONTENT_READ] })

    assert.strictEqual(await pruneExpiredApiTokens(), 1)
    assert.ok(await verifyApiToken(live.token))
  })
})

describe('isApiToken', () => {
  test('distinguishes tokens from JWTs', () => {
    assert.strictEqual(isApiToken(`${TOKEN_PREFIX}abc`), true)
    assert.strictEqual(isApiToken('eyJhbGciOiJIUzI1NiJ9.e30.abc'), false)
    assert.strictEqual(isApiToken(undefined), false)
  })
})

describe('hasScope', () => {
  test('exact, implied, and absent', () => {
    assert.strictEqual(hasScope([SCOPES.CONTENT_READ], SCOPES.CONTENT_READ), true)
    assert.strictEqual(hasScope([SCOPES.CONTENT_WRITE], SCOPES.CONTENT_READ), true)
    assert.strictEqual(hasScope([SCOPES.CONTENT_READ], SCOPES.CONTENT_WRITE), false)
    assert.strictEqual(hasScope([SCOPES.MEDIA_WRITE], SCOPES.CONTENT_READ), false)
    assert.strictEqual(hasScope(null, SCOPES.CONTENT_READ), false)
  })
})
