/**
 * Rate limiter tests.
 *
 * Both stores are put through the same behavioural suite, because a limiter
 * that behaves differently depending on where it keeps its state is a trap: the
 * memory store would pass in development and the database store would be the
 * one enforcing the lockout in production.
 */

import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSqliteAdapter } from '../db/adapters/sqlite.js'
import {
  createLimiter,
  rateLimit,
  parseDuration,
  clientAddress,
  MemoryStore,
  DatabaseStore
} from './rate-limit.js'


/**
 * A clock the test controls.
 *
 * These tests used to sleep — 80ms for a 300ms lockout, 140ms for a 120ms
 * window. Margins like that hold on an idle laptop and fail on a shared CI
 * runner, where a setTimeout can overshoot by hundreds of milliseconds. Two of
 * them did exactly that, and blocked a release.
 *
 * Advancing a fake clock tests the same behaviour with no timing at all, and
 * lets the durations be realistic — minutes, as they are in production, rather
 * than milliseconds chosen to keep the suite fast.
 */
function fakeClock(start = 1_700_000_000_000) {
  let current = start

  return {
    now: () => current,
    advance: (ms) => { current += ms }
  }
}

describe('parseDuration', () => {
  test('accepts a number as milliseconds', () => {
    assert.strictEqual(parseDuration(500), 500)
  })

  test('accepts suffixed strings', () => {
    assert.strictEqual(parseDuration('250ms'), 250)
    assert.strictEqual(parseDuration('30s'), 30_000)
    assert.strictEqual(parseDuration('15m'), 900_000)
    assert.strictEqual(parseDuration('2h'), 7_200_000)
    assert.strictEqual(parseDuration('1d'), 86_400_000)
  })

  test('rejects nonsense rather than defaulting', () => {
    assert.throws(() => parseDuration('soon'), /Cannot parse duration/)
    assert.throws(() => parseDuration('5 weeks'), /Cannot parse duration/)
  })
})

// ---------------------------------------------------------------------------
// One suite, run against both stores
// ---------------------------------------------------------------------------

let dir
let db

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'basicben-ratelimit-'))
  db = await createSqliteAdapter(join(dir, 'limits.db'))
  await db.exec(`
    CREATE TABLE rate_limits (
      key TEXT PRIMARY KEY,
      hits TEXT NOT NULL,
      blocked_until INTEGER,
      updated_at INTEGER NOT NULL
    )
  `)
})

after(async () => {
  await db.close()
  rmSync(dir, { recursive: true, force: true })
})

const stores = [
  ['MemoryStore', () => new MemoryStore({ sweepInterval: 0 })],
  ['DatabaseStore', () => new DatabaseStore({ getDb: async () => db })]
]

for (const [name, makeStore] of stores) {
  describe(`${name} — limiting`, () => {
    let store

    beforeEach(async () => {
      store = makeStore()
      if (store instanceof DatabaseStore) await db.exec('DELETE FROM rate_limits')
    })

    test('allows up to the limit', async () => {
      const limiter = createLimiter({ limit: 3, window: '1m', store })

      for (let i = 0; i < 3; i++) {
        const result = await limiter.consume('a')
        assert.strictEqual(result.allowed, true, `hit ${i + 1} should be allowed`)
      }
    })

    test('refuses past the limit', async () => {
      const limiter = createLimiter({ limit: 3, window: '1m', store })

      for (let i = 0; i < 3; i++) await limiter.consume('a')

      const result = await limiter.consume('a')
      assert.strictEqual(result.allowed, false)
      assert.strictEqual(result.remaining, 0)
      assert.ok(result.retryAfter > 0)
    })

    test('counts down remaining', async () => {
      const limiter = createLimiter({ limit: 3, window: '1m', store })

      assert.strictEqual((await limiter.consume('a')).remaining, 2)
      assert.strictEqual((await limiter.consume('a')).remaining, 1)
      assert.strictEqual((await limiter.consume('a')).remaining, 0)
    })

    test('keys are independent', async () => {
      const limiter = createLimiter({ limit: 2, window: '1m', store })

      await limiter.consume('a')
      await limiter.consume('a')

      assert.strictEqual((await limiter.consume('a')).allowed, false)
      assert.strictEqual((await limiter.consume('b')).allowed, true)
    })

    test('the window slides rather than resetting on a boundary', async () => {
      // A fixed window would allow the full limit again the instant the window
      // ticks over, so "2 per minute" would permit 4 in a fraction of a second.
      const clock = fakeClock()
      const limiter = createLimiter({ limit: 2, window: '1m', store, now: clock.now })

      await limiter.consume('a')
      await limiter.consume('a')
      assert.strictEqual((await limiter.consume('a')).allowed, false)

      clock.advance(61_000)

      assert.strictEqual((await limiter.consume('a')).allowed, true, 'the window should have slid')
    })

    test('peek reports state without consuming', async () => {
      const limiter = createLimiter({ limit: 2, window: '1m', store })

      await limiter.consume('a')

      assert.strictEqual((await limiter.peek('a')).remaining, 1)
      assert.strictEqual((await limiter.peek('a')).remaining, 1, 'peek must not count')
      assert.strictEqual((await limiter.consume('a')).remaining, 0)
    })

    test('reset clears a key', async () => {
      const limiter = createLimiter({ limit: 1, window: '1m', store })

      await limiter.consume('a')
      assert.strictEqual((await limiter.consume('a')).allowed, false)

      await limiter.reset('a')

      assert.strictEqual((await limiter.consume('a')).allowed, true)
    })
  })

  describe(`${name} — lockout`, () => {
    let store

    beforeEach(async () => {
      store = makeStore()
      if (store instanceof DatabaseStore) await db.exec('DELETE FROM rate_limits')
    })

    test('blockFor keeps refusing after the window would have passed', async () => {
      const clock = fakeClock()
      const limiter = createLimiter({ limit: 2, window: '1m', blockFor: '15m', store, now: clock.now })

      await limiter.consume('a')
      await limiter.consume('a')
      assert.strictEqual((await limiter.consume('a')).allowed, false)

      // Past the window, well short of the block.
      clock.advance(2 * 60_000)

      const stillBlocked = await limiter.consume('a')
      assert.strictEqual(stillBlocked.allowed, false, 'the lockout should outlast the window')
    })

    test('the lockout lapses', async () => {
      const clock = fakeClock()
      const limiter = createLimiter({ limit: 1, window: '1m', blockFor: '15m', store, now: clock.now })

      await limiter.consume('a')
      assert.strictEqual((await limiter.consume('a')).allowed, false)

      clock.advance(16 * 60_000)

      assert.strictEqual((await limiter.consume('a')).allowed, true)
    })

    test('a lapsed lockout does not immediately re-lock', async () => {
      // If the hit count survived the block, the next single attempt would lock
      // again at once and the account would be permanently unusable.
      const clock = fakeClock()
      const limiter = createLimiter({ limit: 2, window: '1h', blockFor: '15m', store, now: clock.now })

      await limiter.consume('a')
      await limiter.consume('a')
      await limiter.consume('a')

      clock.advance(16 * 60_000)

      assert.strictEqual((await limiter.consume('a')).allowed, true)
      assert.strictEqual((await limiter.consume('a')).allowed, true)
    })

    test('reports how long to wait', async () => {
      const limiter = createLimiter({ limit: 1, window: '1m', blockFor: '15m', store })

      await limiter.consume('a')
      const result = await limiter.consume('a')

      assert.ok(result.retryAfter > 800 && result.retryAfter <= 900, `got ${result.retryAfter}s`)
    })
  })
}

describe('DatabaseStore persistence', () => {
  beforeEach(async () => { await db.exec('DELETE FROM rate_limits') })

  test('a lockout survives a new store instance, as a restart would', async () => {
    const first = createLimiter({
      limit: 1, window: '1m', blockFor: '5m',
      store: new DatabaseStore({ getDb: async () => db })
    })

    await first.consume('user:1')
    assert.strictEqual((await first.consume('user:1')).allowed, false)

    // A different store object over the same table is what a second process,
    // or the same process after a restart, would see.
    const second = createLimiter({
      limit: 1, window: '1m', blockFor: '5m',
      store: new DatabaseStore({ getDb: async () => db })
    })

    assert.strictEqual((await second.consume('user:1')).allowed, false, 'the lockout must be shared')
  })
})

describe('MemoryStore housekeeping', () => {
  test('sweeps keys whose window has passed', async () => {
    const clock = fakeClock()
    const store = new MemoryStore({ sweepInterval: 0 })
    const limiter = createLimiter({ limit: 5, window: '1m', store, now: clock.now })

    await limiter.consume('a')
    await limiter.consume('b')
    assert.strictEqual(store.size, 2)

    // sweep() takes the time to sweep at, so no waiting is needed.
    store.sweep(clock.now() + 61_000)

    assert.strictEqual(store.size, 0)
  })

  test('does not sweep a key that is still blocked', async () => {
    const clock = fakeClock()
    const store = new MemoryStore({ sweepInterval: 0 })
    const limiter = createLimiter({ limit: 1, window: '1m', blockFor: '5m', store, now: clock.now })

    await limiter.consume('a')
    await limiter.consume('a')

    // Past the window, inside the block.
    store.sweep(clock.now() + 2 * 60_000)

    assert.strictEqual(store.size, 1, 'a blocked key must survive the sweep')
  })
})

describe('clientAddress', () => {
  const req = (headers, remote = '10.0.0.1') => ({ headers, socket: { remoteAddress: remote } })

  test('uses the socket address by default', () => {
    assert.strictEqual(clientAddress(req({ 'x-forwarded-for': '1.2.3.4' })), '10.0.0.1')
  })

  test('ignoring X-Forwarded-For by default is the point', () => {
    // The header is client-supplied. Honouring it on a directly-exposed server
    // would let anyone rotate their apparent address and bypass every limit.
    const spoofed = req({ 'x-forwarded-for': '9.9.9.9' })
    assert.notStrictEqual(clientAddress(spoofed), '9.9.9.9')
  })

  test('honours it when the proxy is trusted', () => {
    assert.strictEqual(clientAddress(req({ 'x-forwarded-for': '1.2.3.4' }), true), '1.2.3.4')
  })

  test('takes the left-most entry, which is the original client', () => {
    const chained = req({ 'x-forwarded-for': '1.2.3.4, 10.0.0.5, 10.0.0.6' })
    assert.strictEqual(clientAddress(chained, true), '1.2.3.4')
  })

  test('falls back to X-Real-IP', () => {
    assert.strictEqual(clientAddress(req({ 'x-real-ip': '5.6.7.8' }), true), '5.6.7.8')
  })

  test('falls back to the socket when no header is present', () => {
    assert.strictEqual(clientAddress(req({}), true), '10.0.0.1')
  })
})

describe('middleware', () => {
  const makeRes = () => ({
    headers: {},
    status: null,
    body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    json(body, status = 200) { this.body = body; this.status = status }
  })

  const makeReq = (address = '1.2.3.4') => ({ headers: {}, socket: { remoteAddress: address } })

  test('passes a request under the limit and sets headers', async () => {
    const middleware = rateLimit({ limit: 2, window: '1m', store: new MemoryStore({ sweepInterval: 0 }) })
    const res = makeRes()
    let advanced = false

    await middleware(makeReq(), res, () => { advanced = true })

    assert.strictEqual(advanced, true)
    assert.strictEqual(res.headers['ratelimit-limit'], '2')
    assert.strictEqual(res.headers['ratelimit-remaining'], '1')
  })

  test('answers 429 with Retry-After past the limit', async () => {
    const middleware = rateLimit({ limit: 1, window: '1m', store: new MemoryStore({ sweepInterval: 0 }) })
    const res = makeRes()

    await middleware(makeReq(), res, () => {})
    await middleware(makeReq(), makeRes(), () => {})

    const blocked = makeRes()
    let advanced = false
    await middleware(makeReq(), blocked, () => { advanced = true })

    assert.strictEqual(blocked.status, 429)
    assert.strictEqual(advanced, false)
    assert.ok(blocked.headers['retry-after'])
    assert.ok(blocked.body.error)
  })

  test('limits per caller, not globally', async () => {
    const middleware = rateLimit({ limit: 1, window: '1m', store: new MemoryStore({ sweepInterval: 0 }) })

    await middleware(makeReq('1.1.1.1'), makeRes(), () => {})

    let advanced = false
    await middleware(makeReq('2.2.2.2'), makeRes(), () => { advanced = true })

    assert.strictEqual(advanced, true, 'one caller must not lock out another')
  })

  test('a custom key groups requests differently', async () => {
    const middleware = rateLimit({
      limit: 1,
      window: '1m',
      store: new MemoryStore({ sweepInterval: 0 }),
      key: (req) => req.body?.email
    })

    const req1 = { ...makeReq('1.1.1.1'), body: { email: 'a@b.c' } }
    const req2 = { ...makeReq('9.9.9.9'), body: { email: 'a@b.c' } }

    await middleware(req1, makeRes(), () => {})

    const res = makeRes()
    await middleware(req2, res, () => {})

    assert.strictEqual(res.status, 429, 'the same email from a new address is still limited')
  })

  test('a request it cannot identify is allowed rather than sharing one bucket', async () => {
    const middleware = rateLimit({
      limit: 1, window: '1m',
      store: new MemoryStore({ sweepInterval: 0 }),
      key: () => null
    })

    let advanced = 0
    await middleware(makeReq(), makeRes(), () => { advanced++ })
    await middleware(makeReq(), makeRes(), () => { advanced++ })

    assert.strictEqual(advanced, 2, 'one shared bucket would let one abuser lock out everyone')
  })

  test('exposes its limiter and key so a handler can clear a success', async () => {
    const middleware = rateLimit({
      limit: 2, window: '1m',
      store: new MemoryStore({ sweepInterval: 0 })
    })
    const req = makeReq('7.7.7.7')

    await middleware(req, makeRes(), () => {})
    await middleware(req, makeRes(), () => {})

    const blocked = makeRes()
    await middleware(req, blocked, () => {})
    assert.strictEqual(blocked.status, 429)

    // A correct password should not leave the caller part-way to a lockout.
    await middleware.limiter.reset(middleware.key(req))

    let advanced = false
    await middleware(req, makeRes(), () => { advanced = true })
    assert.strictEqual(advanced, true)
  })

  test('headers can be suppressed', async () => {
    const middleware = rateLimit({
      limit: 5, window: '1m', headers: false,
      store: new MemoryStore({ sweepInterval: 0 })
    })
    const res = makeRes()

    await middleware(makeReq(), res, () => {})

    assert.strictEqual(res.headers['ratelimit-limit'], undefined)
  })
})

describe('configuration', () => {
  test('a limit is required', () => {
    assert.throws(() => createLimiter({ window: '1m' }), /requires a positive limit/)
    assert.throws(() => createLimiter({ limit: 0, window: '1m' }), /requires a positive limit/)
  })
})
