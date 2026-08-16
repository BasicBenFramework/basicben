/**
 * Tests for Postgres adapter configuration.
 *
 * These cover the pool settings only, which needs no server — connecting is
 * what the adapter's other paths do, and there is no Postgres in CI.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { poolOptions } from './postgres.js'

const URL = 'postgres://user@localhost:5432/app'

describe('Postgres pool options', () => {
  test('lets the process exit once clients are idle', () => {
    // Without this, a pool with one idle client holds the event loop open for
    // the whole idle timeout, so every CLI command appears to hang for 30
    // seconds after it has already finished and committed its work.
    assert.strictEqual(poolOptions(URL).allowExitOnIdle, true)
  })

  test('a project can opt back in to holding the loop open', () => {
    assert.strictEqual(poolOptions(URL, { allowExitOnIdle: false }).allowExitOnIdle, false)
  })

  test('defaults', () => {
    const options = poolOptions(URL)

    assert.strictEqual(options.connectionString, URL)
    assert.strictEqual(options.max, 10)
    assert.strictEqual(options.idleTimeoutMillis, 30000)
    assert.strictEqual(options.connectionTimeoutMillis, 2000)
  })

  test('config overrides the defaults', () => {
    const options = poolOptions(URL, {
      poolSize: 25,
      idleTimeout: 1000,
      connectionTimeout: 500
    })

    assert.strictEqual(options.max, 25)
    assert.strictEqual(options.idleTimeoutMillis, 1000)
    assert.strictEqual(options.connectionTimeoutMillis, 500)
  })
})
