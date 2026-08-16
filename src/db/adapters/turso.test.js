/**
 * Turso adapter tests.
 *
 * These run against a real HTTP server that speaks Hrana 3 and executes real
 * SQL through node:sqlite, rather than a mocked fetch. That matters because the
 * bugs worth catching live in the wire format, not in the call graph: integers
 * travel as strings, rowids travel as strings, blobs travel as base64, and a
 * transaction only holds together if every statement carries the same baton. A
 * mock that returns whatever the adapter expects would prove none of it.
 *
 * The server encodes values exactly as the spec requires, so decoding is under
 * test on every assertion.
 *
 * Tests against a genuine Turso database run too when TURSO_URL and
 * TURSO_AUTH_TOKEN are set; they skip otherwise, so CI needs no credentials.
 */

import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  createTursoAdapter,
  toHttpUrl,
  encodeValue,
  decodeValue
} from './turso.js'
import { QueryBuilder } from '../QueryBuilder.js'
import { createMigrator } from '../migrator.js'
import { detectDriver, resolveUrl } from '../index.js'

// ---------------------------------------------------------------------------
// A minimal Hrana 3 server
// ---------------------------------------------------------------------------

/**
 * Encode a JS value from node:sqlite as a Hrana Value.
 *
 * Integers and rowids are stringified deliberately — that is what libSQL does,
 * and it is the single most likely thing for a client to get wrong.
 */
function encodeServerValue(value) {
  if (value === null || value === undefined) return { type: 'null' }
  if (typeof value === 'bigint') return { type: 'integer', value: value.toString() }
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { type: 'integer', value: String(value) }
      : { type: 'float', value }
  }
  if (typeof value === 'string') return { type: 'text', value }
  if (value instanceof Uint8Array) {
    return { type: 'blob', base64: Buffer.from(value).toString('base64') }
  }
  return { type: 'text', value: String(value) }
}

/** Hrana Value → a value node:sqlite can bind. */
function decodeServerValue(value) {
  switch (value?.type) {
    case 'null': return null
    case 'integer': {
      const n = Number(value.value)
      return Number.isSafeInteger(n) ? n : BigInt(value.value)
    }
    case 'float': return value.value
    case 'text': return value.value
    case 'blob': return Buffer.from(value.base64 ?? '', 'base64')
    default: return null
  }
}

/**
 * Start a Hrana 3 server backed by a SQLite file.
 *
 * Each stream gets its own connection, which is what allows a transaction on
 * one stream to be isolated from everything else — the same property batons
 * provide against the real service.
 */
async function startHranaServer(dbPath) {
  const streams = new Map()
  const log = { requests: [], batons: [] }

  const server = createServer((req, res) => {
    if (req.method !== 'POST' || !req.url.startsWith('/v3/pipeline')) {
      res.writeHead(404).end('not found')
      return
    }

    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      let payload
      try {
        payload = JSON.parse(body)
      } catch {
        res.writeHead(400).end('bad json')
        return
      }

      log.requests.push({ baton: payload.baton, requests: payload.requests, auth: req.headers.authorization })
      log.batons.push(payload.baton)

      let baton = payload.baton
      let db

      if (baton) {
        db = streams.get(baton)
        if (!db) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            baton: null,
            base_url: null,
            results: [{ type: 'error', error: { message: 'stream not found', code: 'STREAM_EXPIRED' } }]
          }))
          return
        }
      } else {
        db = new DatabaseSync(dbPath)
        baton = randomUUID()
        streams.set(baton, db)
      }

      const results = []
      let closed = false

      for (const request of payload.requests || []) {
        try {
          if (request.type === 'close') {
            db.close()
            streams.delete(baton)
            closed = true
            results.push({ type: 'ok', response: { type: 'close' } })
            continue
          }

          if (request.type === 'sequence') {
            db.exec(request.sql)
            results.push({ type: 'ok', response: { type: 'sequence' } })
            continue
          }

          if (request.type === 'execute') {
            const { sql, args = [], want_rows: wantRows } = request.stmt
            const bound = args.map(decodeServerValue)
            const stmt = db.prepare(sql)

            if (wantRows) {
              const rows = stmt.all(...bound)
              let names = []
              try {
                names = stmt.columns().map((c) => c.name)
              } catch {
                names = rows.length ? Object.keys(rows[0]) : []
              }
              results.push({
                type: 'ok',
                response: {
                  type: 'execute',
                  result: {
                    cols: names.map((name) => ({ name, decltype: null })),
                    rows: rows.map((row) => names.map((n) => encodeServerValue(row[n]))),
                    affected_row_count: 0,
                    last_insert_rowid: null
                  }
                }
              })
            } else {
              const info = stmt.run(...bound)
              results.push({
                type: 'ok',
                response: {
                  type: 'execute',
                  result: {
                    cols: [],
                    rows: [],
                    affected_row_count: Number(info.changes ?? 0),
                    // stringified, exactly as libSQL sends it
                    last_insert_rowid: info.lastInsertRowid == null
                      ? null
                      : String(info.lastInsertRowid)
                  }
                }
              })
            }
            continue
          }

          results.push({ type: 'error', error: { message: `unsupported request ${request.type}` } })
        } catch (err) {
          results.push({ type: 'error', error: { message: err.message, code: 'SQLITE_ERROR' } })
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        baton: closed ? null : baton,
        base_url: null,
        results
      }))
    })
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()

  return {
    url: `http://127.0.0.1:${port}`,
    log,
    openStreams: () => streams.size,
    async stop() {
      for (const db of streams.values()) {
        try { db.close() } catch { /* already closed */ }
      }
      streams.clear()
      await new Promise((resolve) => server.close(resolve))
    }
  }
}

// ---------------------------------------------------------------------------

let dir
let dbPath
let hrana
let db

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'basicben-turso-'))
  dbPath = join(dir, 'test.db')
  hrana = await startHranaServer(dbPath)
})

after(async () => {
  await hrana.stop()
  rmSync(dir, { recursive: true, force: true })
})

beforeEach(async () => {
  const seed = new DatabaseSync(dbPath)
  seed.exec('DROP TABLE IF EXISTS users')
  seed.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      score REAL,
      active INTEGER,
      avatar BLOB
    )
  `)
  seed.close()

  db = await createTursoAdapter(hrana.url, { authToken: 'test-token' })
})

describe('URL normalization', () => {
  test('libsql:// becomes https:// with the pipeline path', () => {
    assert.strictEqual(toHttpUrl('libsql://db.turso.io'), 'https://db.turso.io/v3/pipeline')
  })

  test('wss:// and ws:// map to https:// and http://', () => {
    assert.strictEqual(toHttpUrl('wss://db.turso.io'), 'https://db.turso.io/v3/pipeline')
    assert.strictEqual(toHttpUrl('ws://127.0.0.1:8080'), 'http://127.0.0.1:8080/v3/pipeline')
  })

  test('an explicit path is left alone', () => {
    assert.strictEqual(toHttpUrl('http://localhost:8080/v2/pipeline'), 'http://localhost:8080/v2/pipeline')
  })

  test('rejects an unusable URL', () => {
    assert.throws(() => toHttpUrl('postgres://localhost/db'), /Unsupported Turso URL/)
    assert.throws(() => toHttpUrl(''), /requires a database URL/)
  })
})

describe('value encoding', () => {
  test('integers are sent as strings', () => {
    assert.deepStrictEqual(encodeValue(42), { type: 'integer', value: '42' })
    assert.deepStrictEqual(encodeValue(0), { type: 'integer', value: '0' })
  })

  test('floats stay numbers', () => {
    assert.deepStrictEqual(encodeValue(1.5), { type: 'float', value: 1.5 })
  })

  test('booleans become 1 and 0, as SQLite has no boolean', () => {
    assert.deepStrictEqual(encodeValue(true), { type: 'integer', value: '1' })
    assert.deepStrictEqual(encodeValue(false), { type: 'integer', value: '0' })
  })

  test('null and undefined are both null', () => {
    assert.deepStrictEqual(encodeValue(null), { type: 'null' })
    assert.deepStrictEqual(encodeValue(undefined), { type: 'null' })
  })

  test('bigints survive as strings', () => {
    assert.deepStrictEqual(encodeValue(9007199254740993n), { type: 'integer', value: '9007199254740993' })
  })

  test('buffers become base64 blobs', () => {
    assert.deepStrictEqual(encodeValue(Buffer.from('hi')), { type: 'blob', base64: 'aGk=' })
  })

  test('dates become ISO text', () => {
    const d = new Date('2026-08-16T12:00:00.000Z')
    assert.deepStrictEqual(encodeValue(d), { type: 'text', value: '2026-08-16T12:00:00.000Z' })
  })

  test('non-finite numbers are refused rather than silently corrupted', () => {
    assert.throws(() => encodeValue(NaN), /non-finite/)
    assert.throws(() => encodeValue(Infinity), /non-finite/)
  })

  test('an unbindable value is refused', () => {
    assert.throws(() => encodeValue({ a: 1 }), /Cannot bind value/)
  })
})

describe('value decoding', () => {
  test('a stringified integer comes back as a number', () => {
    assert.strictEqual(decodeValue({ type: 'integer', value: '42' }), 42)
    assert.strictEqual(typeof decodeValue({ type: 'integer', value: '42' }), 'number')
  })

  test('an integer beyond 2^53 becomes a BigInt rather than rounding', () => {
    const decoded = decodeValue({ type: 'integer', value: '9007199254740993' })
    assert.strictEqual(typeof decoded, 'bigint')
    assert.strictEqual(decoded, 9007199254740993n)
  })

  test('blobs come back as buffers', () => {
    assert.ok(Buffer.from('hi').equals(decodeValue({ type: 'blob', base64: 'aGk=' })))
  })

  test('null decodes to null', () => {
    assert.strictEqual(decodeValue({ type: 'null' }), null)
  })
})

describe('queries', () => {
  test('run() reports the new rowid and the change count', async () => {
    const result = await db.run('INSERT INTO users (name) VALUES (?)', ['Ada'])

    assert.strictEqual(result.lastInsertRowid, 1)
    assert.strictEqual(typeof result.lastInsertRowid, 'number', 'rowid arrives as a string and must be converted')
    assert.strictEqual(result.changes, 1)
  })

  test('get() returns one row keyed by column name', async () => {
    await db.run('INSERT INTO users (name, score) VALUES (?, ?)', ['Ada', 99.5])

    const row = await db.get('SELECT * FROM users WHERE name = ?', ['Ada'])

    assert.strictEqual(row.name, 'Ada')
    assert.strictEqual(row.score, 99.5)
    assert.strictEqual(row.id, 1)
  })

  test('get() returns undefined when nothing matches', async () => {
    assert.strictEqual(await db.get('SELECT * FROM users WHERE name = ?', ['nobody']), undefined)
  })

  test('all() returns every row in order', async () => {
    await db.run('INSERT INTO users (name) VALUES (?)', ['Ada'])
    await db.run('INSERT INTO users (name) VALUES (?)', ['Grace'])

    const rows = await db.all('SELECT name FROM users ORDER BY id')

    assert.deepStrictEqual(rows.map((r) => r.name), ['Ada', 'Grace'])
  })

  test('all() returns [] rather than null for no matches', async () => {
    assert.deepStrictEqual(await db.all('SELECT * FROM users'), [])
  })

  test('booleans bind, and read back as 1 and 0', async () => {
    await db.run('INSERT INTO users (name, active) VALUES (?, ?)', ['Ada', true])
    await db.run('INSERT INTO users (name, active) VALUES (?, ?)', ['Grace', false])

    assert.strictEqual((await db.get('SELECT active FROM users WHERE name = ?', ['Ada'])).active, 1)
    assert.strictEqual((await db.get('SELECT active FROM users WHERE name = ?', ['Grace'])).active, 0)
  })

  test('a blob survives the round trip', async () => {
    const avatar = Buffer.from([0x00, 0x01, 0xff, 0xfe])
    await db.run('INSERT INTO users (name, avatar) VALUES (?, ?)', ['Ada', avatar])

    const row = await db.get('SELECT avatar FROM users WHERE name = ?', ['Ada'])

    assert.ok(Buffer.isBuffer(row.avatar))
    assert.ok(avatar.equals(row.avatar))
  })

  test('null binds as null', async () => {
    await db.run('INSERT INTO users (name, score) VALUES (?, ?)', ['Ada', null])

    assert.strictEqual((await db.get('SELECT score FROM users WHERE name = ?', ['Ada'])).score, null)
  })

  test('a scalar parameter is accepted without an array', async () => {
    await db.run('INSERT INTO users (name) VALUES (?)', 'Ada')

    assert.strictEqual((await db.get('SELECT name FROM users')).name, 'Ada')
  })

  test('a SQL error surfaces with its message', async () => {
    await assert.rejects(() => db.all('SELECT * FROM missing_table'), /missing_table/)
  })
})

describe('exec', () => {
  test('runs a multi-statement script', async () => {
    await db.exec(`
      INSERT INTO users (name) VALUES ('Ada');
      INSERT INTO users (name) VALUES ('Grace');
      INSERT INTO users (name) VALUES ('Katherine');
    `)

    assert.strictEqual((await db.all('SELECT * FROM users')).length, 3)
  })

  test('creates schema, which is what migrations need', async () => {
    await db.exec('CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)')
    await db.run('INSERT INTO posts (title) VALUES (?)', ['Hello'])

    assert.strictEqual((await db.get('SELECT title FROM posts')).title, 'Hello')
    await db.exec('DROP TABLE posts')
  })

  test('a failing script reports the error', async () => {
    await assert.rejects(() => db.exec('CREATE TABLE bad ('), /.+/)
  })
})

describe('transactions', () => {
  test('commits when the callback returns', async () => {
    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO users (name) VALUES (?)', ['Ada'])
      await tx.run('INSERT INTO users (name) VALUES (?)', ['Grace'])
    })

    assert.strictEqual((await db.all('SELECT * FROM users')).length, 2)
  })

  test('rolls back when the callback throws', async () => {
    await assert.rejects(
      () => db.transaction(async (tx) => {
        await tx.run('INSERT INTO users (name) VALUES (?)', ['Ada'])
        throw new Error('Simulated failure')
      }),
      /Simulated failure/
    )

    assert.strictEqual((await db.all('SELECT * FROM users')).length, 0)
  })

  test('passes a transaction-scoped adapter, matching the other drivers', async () => {
    await db.transaction(async (tx) => {
      assert.strictEqual(typeof tx.run, 'function')
      assert.strictEqual(typeof tx.get, 'function')
      assert.strictEqual(typeof tx.all, 'function')
      assert.strictEqual(tx.driver, 'turso')
    })
  })

  test('reads its own uncommitted writes', async () => {
    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO users (name) VALUES (?)', ['Ada'])
      const row = await tx.get('SELECT name FROM users WHERE name = ?', ['Ada'])
      assert.strictEqual(row.name, 'Ada')
    })
  })

  test('returns the callback result', async () => {
    const returned = await db.transaction(async () => 'done')
    assert.strictEqual(returned, 'done')
  })

  test('every statement travels on the transaction baton', async () => {
    const before = hrana.log.requests.length

    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO users (name) VALUES (?)', ['Ada'])
      await tx.run('INSERT INTO users (name) VALUES (?)', ['Grace'])
    })

    // BEGIN opens the stream, so every request after it must carry a baton.
    // Without that the statements would land outside the transaction and the
    // rollback test above would pass for the wrong reason.
    const sent = hrana.log.requests.slice(before)
    assert.ok(sent.length >= 4, `expected BEGIN, two inserts and COMMIT, saw ${sent.length}`)
    assert.strictEqual(sent[0].baton, null, 'BEGIN opens a new stream')
    for (const request of sent.slice(1)) {
      assert.ok(request.baton, 'a statement inside the transaction must reuse the baton')
    }
  })

  test('leaves no stream open afterwards', async () => {
    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO users (name) VALUES (?)', ['Ada'])
    })

    assert.strictEqual(hrana.openStreams(), 0, 'the transaction stream should be closed')
  })

  test('closes its stream even when it rolls back', async () => {
    await assert.rejects(() => db.transaction(async () => { throw new Error('nope') }))

    assert.strictEqual(hrana.openStreams(), 0)
  })
})

describe('streams', () => {
  test('a standalone query leaves nothing open', async () => {
    await db.run('INSERT INTO users (name) VALUES (?)', ['Ada'])
    await db.all('SELECT * FROM users')

    assert.strictEqual(hrana.openStreams(), 0)
  })
})

describe('authentication', () => {
  test('sends the token as a bearer header', async () => {
    const before = hrana.log.requests.length
    await db.all('SELECT * FROM users')

    assert.strictEqual(hrana.log.requests[before].auth, 'Bearer test-token')
  })

  test('a hosted Turso URL without a token is refused up front', async () => {
    await assert.rejects(
      () => createTursoAdapter('libsql://example.turso.io', { authToken: '' }),
      /requires an auth token/
    )
  })

  test('a local server without a token is allowed', async () => {
    const local = await createTursoAdapter(hrana.url, { authToken: '' })
    assert.deepStrictEqual(await local.all('SELECT * FROM users'), [])
  })
})

describe('transport failures', () => {
  test('a non-200 response reports the status', async () => {
    const bad = await createTursoAdapter('http://127.0.0.1:1/v3/pipeline', {
      authToken: 't',
      fetch: async () => new Response('upstream is unwell', { status: 503 })
    })

    await assert.rejects(() => bad.all('SELECT 1'), /503/)
  })

  test('a timeout is reported as one', async () => {
    const slow = await createTursoAdapter('http://127.0.0.1:1/v3/pipeline', {
      authToken: 't',
      timeout: 20,
      fetch: (url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    })

    await assert.rejects(() => slow.all('SELECT 1'), /timed out after 20ms/)
  })

  test('a network error is wrapped rather than leaking', async () => {
    const broken = await createTursoAdapter('http://127.0.0.1:1/v3/pipeline', {
      authToken: 't',
      fetch: async () => { throw new Error('ECONNREFUSED') }
    })

    await assert.rejects(() => broken.all('SELECT 1'), /Turso request failed: ECONNREFUSED/)
  })
})

// ---------------------------------------------------------------------------
// Optional: run the same surface against a real Turso database.
// ---------------------------------------------------------------------------

const liveUrl = process.env.TURSO_URL
const liveToken = process.env.TURSO_AUTH_TOKEN

describe('against a real Turso database', { skip: !liveUrl || !liveToken }, () => {
  let live
  const table = `bb_test_${Date.now()}`

  before(async () => {
    live = await createTursoAdapter(liveUrl, { authToken: liveToken })
    await live.exec(`CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY, name TEXT)`)
  })

  after(async () => {
    if (live) {
      await live.exec(`DROP TABLE IF EXISTS ${table}`)
      await live.close()
    }
  })

  test('round-trips a row', async () => {
    const inserted = await live.run(`INSERT INTO ${table} (name) VALUES (?)`, ['Ada'])
    assert.strictEqual(typeof inserted.lastInsertRowid, 'number')

    const row = await live.get(`SELECT name FROM ${table} WHERE id = ?`, [inserted.lastInsertRowid])
    assert.strictEqual(row.name, 'Ada')
  })

  test('commits and rolls back', async () => {
    await live.transaction(async (tx) => {
      await tx.run(`INSERT INTO ${table} (name) VALUES (?)`, ['Committed'])
    })
    assert.ok(await live.get(`SELECT 1 AS ok FROM ${table} WHERE name = ?`, ['Committed']))

    await assert.rejects(() => live.transaction(async (tx) => {
      await tx.run(`INSERT INTO ${table} (name) VALUES (?)`, ['Rolled back'])
      throw new Error('rollback')
    }))
    assert.strictEqual(await live.get(`SELECT 1 AS ok FROM ${table} WHERE name = ?`, ['Rolled back']), undefined)
  })
})

// ---------------------------------------------------------------------------
// The adapter is only useful if the layers above it work on top of it.
// ---------------------------------------------------------------------------

describe('QueryBuilder over Turso', () => {
  test('insert reports the new id without a RETURNING clause', async () => {
    const users = new QueryBuilder(db, 'users', 'turso')
    const result = await users.insert({ name: 'Ada', score: 99.5 })

    // libSQL is SQLite: RETURNING is a Postgres-only workaround here, and
    // emitting it would be both unnecessary and wrong.
    assert.strictEqual(result.lastInsertRowid, 1)
    assert.strictEqual(result.changes, 1)
  })

  test('generated SQL uses ? placeholders, not $1', async () => {
    const sql = new QueryBuilder(db, 'users', 'turso')
      .where('name', 'Ada')
      .whereNull('avatar')
      .toSql()

    assert.match(sql, /\?/)
    assert.doesNotMatch(sql, /\$\d/)
  })

  test('where, first and find round-trip', async () => {
    await new QueryBuilder(db, 'users', 'turso').insert({ name: 'Ada' })
    await new QueryBuilder(db, 'users', 'turso').insert({ name: 'Grace' })

    const found = await new QueryBuilder(db, 'users', 'turso').where('name', 'Grace').first()
    assert.strictEqual(found.name, 'Grace')

    const byId = await new QueryBuilder(db, 'users', 'turso').find(1)
    assert.strictEqual(byId.name, 'Ada')
  })

  test('update and delete report their change counts', async () => {
    await new QueryBuilder(db, 'users', 'turso').insert({ name: 'Ada' })

    const updated = await new QueryBuilder(db, 'users', 'turso')
      .where('name', 'Ada')
      .update({ score: 10 })
    assert.strictEqual(updated.changes, 1)

    const deleted = await new QueryBuilder(db, 'users', 'turso').where('name', 'Ada').delete()
    assert.strictEqual(deleted.changes, 1)
  })

  test('count and exists work through the adapter', async () => {
    await new QueryBuilder(db, 'users', 'turso').insert({ name: 'Ada' })
    await new QueryBuilder(db, 'users', 'turso').insert({ name: 'Grace' })

    assert.strictEqual(await new QueryBuilder(db, 'users', 'turso').count(), 2)
    assert.strictEqual(await new QueryBuilder(db, 'users', 'turso').where('name', 'Ada').exists(), true)
    assert.strictEqual(await new QueryBuilder(db, 'users', 'turso').where('name', 'Nobody').exists(), false)
  })

  test('whereNull mixed with where binds the right number of parameters', async () => {
    await new QueryBuilder(db, 'users', 'turso').insert({ name: 'Ada', score: null })

    const rows = await new QueryBuilder(db, 'users', 'turso')
      .where('name', 'Ada')
      .whereNull('score')
      .get()

    assert.strictEqual(rows.length, 1)
  })
})

describe('migrations over Turso', () => {
  let migrationsDir

  beforeEach(() => {
    migrationsDir = mkdtempSync(join(tmpdir(), 'basicben-turso-migrations-'))
    writeFileSync(join(migrationsDir, '001_create_posts.js'), `
      export const up = async (db) => {
        await db.exec(\`
          CREATE TABLE posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        \`)
      }
      export const down = async (db) => { await db.exec('DROP TABLE IF EXISTS posts') }
    `)
  })

  test('runs, records and rolls back', async () => {
    const migrator = await createMigrator(migrationsDir, db)

    const { ran, batch } = await migrator.migrate()
    assert.deepStrictEqual(ran, ['001_create_posts'])
    assert.strictEqual(batch, 1)

    // The runner's own _migrations table has to be creatable on this dialect
    // too, not just the migration's SQL.
    await db.run('INSERT INTO posts (title) VALUES (?)', ['Hello'])
    assert.strictEqual((await db.get('SELECT title FROM posts')).title, 'Hello')

    const status = await migrator.status()
    assert.strictEqual(status[0].name, '001_create_posts')
    assert.strictEqual(status[0].ran, true)
    assert.strictEqual(status[0].batch, 1)

    const { rolledBack } = await migrator.rollback()
    assert.deepStrictEqual(rolledBack, ['001_create_posts'])
    await assert.rejects(() => db.all('SELECT * FROM posts'), /posts/)

    rmSync(migrationsDir, { recursive: true, force: true })
  })
})

describe('driver resolution', () => {
  const env = { ...process.env }
  beforeEach(() => {
    delete process.env.DATABASE_URL
    delete process.env.TURSO_URL
  })
  after(() => { process.env = env })

  test('an explicit config url wins', () => {
    assert.strictEqual(resolveUrl({ url: 'libsql://x.turso.io' }, 'turso'), 'libsql://x.turso.io')
  })

  test('a libsql:// DATABASE_URL selects turso without naming a driver', () => {
    process.env.DATABASE_URL = 'libsql://x.turso.io'
    assert.strictEqual(detectDriver({}), 'turso')
  })

  test('TURSO_URL alone selects turso', () => {
    process.env.TURSO_URL = 'libsql://x.turso.io'
    assert.strictEqual(detectDriver({}), 'turso')
    assert.strictEqual(resolveUrl({}, 'turso'), 'libsql://x.turso.io')
  })

  test('a postgres:// URL still selects postgres', () => {
    process.env.DATABASE_URL = 'postgres://localhost/app'
    assert.strictEqual(detectDriver({}), 'postgres')
  })

  test('nothing set falls back to a local SQLite file', () => {
    assert.strictEqual(detectDriver({}), 'sqlite')
    assert.strictEqual(resolveUrl({}, 'sqlite'), './database.sqlite')
  })

  test('turso without any URL says so rather than opening a stray file', () => {
    assert.throws(() => resolveUrl({}, 'turso'), /Turso requires a database URL/)
  })
})
