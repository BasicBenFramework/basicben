/**
 * Tests for SQLite adapter using node:sqlite
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert'
import { unlinkSync, existsSync } from 'node:fs'
import { createSqliteAdapter } from './sqlite.js'

const TEST_DB = './test-sqlite.db'

describe('SQLite Adapter', () => {
  let db

  before(async () => {
    // Clean up any existing test database
    if (existsSync(TEST_DB)) {
      unlinkSync(TEST_DB)
    }

    db = await createSqliteAdapter(TEST_DB)

    // Create test table
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE
      )
    `)
  })

  after(() => {
    if (db) db.close()
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB)
    if (existsSync(TEST_DB + '-wal')) unlinkSync(TEST_DB + '-wal')
    if (existsSync(TEST_DB + '-shm')) unlinkSync(TEST_DB + '-shm')
  })

  test('run() inserts and returns lastInsertRowid', () => {
    const result = db.run(
      'INSERT INTO users (name, email) VALUES (?, ?)',
      ['Alice', 'alice@test.com']
    )

    // lastInsertRowid is number in Node 22, bigint in Node 24+
    assert.ok(typeof result.lastInsertRowid === 'number' || typeof result.lastInsertRowid === 'bigint')
    assert.strictEqual(Number(result.lastInsertRowid), 1)
    assert.strictEqual(result.changes, 1)
  })

  test('get() returns single row', () => {
    const user = db.get('SELECT * FROM users WHERE id = ?', [1])

    assert.strictEqual(user.name, 'Alice')
    assert.strictEqual(user.email, 'alice@test.com')
  })

  test('get() returns undefined for no match', () => {
    const user = db.get('SELECT * FROM users WHERE id = ?', [999])

    assert.strictEqual(user, undefined)
  })

  test('all() returns array of rows', () => {
    db.run('INSERT INTO users (name, email) VALUES (?, ?)', ['Bob', 'bob@test.com'])

    const users = db.all('SELECT * FROM users ORDER BY id')

    assert.strictEqual(users.length, 2)
    assert.strictEqual(users[0].name, 'Alice')
    assert.strictEqual(users[1].name, 'Bob')
  })

  test('run() updates rows', () => {
    const result = db.run(
      'UPDATE users SET name = ? WHERE id = ?',
      ['Alice Updated', 1]
    )

    assert.strictEqual(result.changes, 1)

    const user = db.get('SELECT * FROM users WHERE id = ?', [1])
    assert.strictEqual(user.name, 'Alice Updated')
  })

  test('run() deletes rows', () => {
    const result = db.run('DELETE FROM users WHERE id = ?', [2])

    assert.strictEqual(result.changes, 1)

    const users = db.all('SELECT * FROM users')
    assert.strictEqual(users.length, 1)
  })

  test('transaction() commits on success', async () => {
    await db.transaction(() => {
      db.run('INSERT INTO users (name, email) VALUES (?, ?)', ['Charlie', 'charlie@test.com'])
      db.run('INSERT INTO users (name, email) VALUES (?, ?)', ['Diana', 'diana@test.com'])
    })

    const users = db.all('SELECT * FROM users')
    assert.strictEqual(users.length, 3)
  })

  test('transaction() rolls back on error', async () => {
    const countBefore = db.all('SELECT * FROM users').length

    await assert.rejects(
      () => db.transaction(() => {
        db.run('INSERT INTO users (name, email) VALUES (?, ?)', ['Eve', 'eve@test.com'])
        throw new Error('Simulated error')
      }),
      /Simulated error/
    )

    const countAfter = db.all('SELECT * FROM users').length
    assert.strictEqual(countAfter, countBefore)
  })

  test('transaction() passes the adapter and awaits an async callback', async () => {
    const countBefore = db.all('SELECT * FROM users').length

    // Postgres passes a transaction-scoped adapter; sqlite matches that so the
    // same code ports. An un-awaited callback would commit before this insert.
    await db.transaction(async (tx) => {
      assert.strictEqual(typeof tx.run, 'function')
      await Promise.resolve()
      tx.run('INSERT INTO users (name, email) VALUES (?, ?)', ['Frank', 'frank@test.com'])
    })

    assert.strictEqual(db.all('SELECT * FROM users').length, countBefore + 1)
  })

  test('transaction() rolls back when an async callback rejects', async () => {
    const countBefore = db.all('SELECT * FROM users').length

    await assert.rejects(
      () => db.transaction(async (tx) => {
        tx.run('INSERT INTO users (name, email) VALUES (?, ?)', ['Grace', 'grace@test.com'])
        await Promise.resolve()
        throw new Error('Async failure')
      }),
      /Async failure/
    )

    assert.strictEqual(db.all('SELECT * FROM users').length, countBefore)
  })
})

describe('parameter binding', () => {
  test('binds booleans as integers', async () => {
    const db = await createSqliteAdapter(':memory:')
    db.exec('CREATE TABLE flags (id INTEGER PRIMARY KEY, on_off INTEGER)')

    // node:sqlite rejects raw booleans, so the adapter coerces them
    db.run('INSERT INTO flags (on_off) VALUES (?)', [true])
    db.run('INSERT INTO flags (on_off) VALUES (?)', [false])

    assert.strictEqual(db.get('SELECT on_off FROM flags WHERE id = 1').on_off, 1)
    assert.strictEqual(db.get('SELECT on_off FROM flags WHERE id = 2').on_off, 0)

    db.close()
  })

  test('matches rows when querying with a boolean', async () => {
    const db = await createSqliteAdapter(':memory:')
    db.exec('CREATE TABLE flags (id INTEGER PRIMARY KEY, on_off INTEGER)')
    db.run('INSERT INTO flags (on_off) VALUES (?)', [true])

    assert.strictEqual(db.all('SELECT * FROM flags WHERE on_off = ?', [true]).length, 1)
    assert.strictEqual(db.all('SELECT * FROM flags WHERE on_off = ?', [false]).length, 0)

    db.close()
  })

  test('binds undefined as NULL', async () => {
    const db = await createSqliteAdapter(':memory:')
    db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)')

    db.run('INSERT INTO notes (body) VALUES (?)', [undefined])

    assert.strictEqual(db.get('SELECT body FROM notes WHERE id = 1').body, null)

    db.close()
  })
})
