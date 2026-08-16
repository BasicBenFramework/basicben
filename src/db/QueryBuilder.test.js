/**
 * Tests for QueryBuilder
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert'
import { unlinkSync, existsSync } from 'node:fs'
import { QueryBuilder } from './QueryBuilder.js'

const TEST_DB = './test-querybuilder.db'

// node:sqlite is built in on the supported Node versions, so this only guards
// against an environment that genuinely cannot open a database.
let createSqliteAdapter
let skipTests = false

try {
  const module = await import('./adapters/sqlite.js')
  createSqliteAdapter = module.createSqliteAdapter
} catch {
  skipTests = true
}

describe('QueryBuilder', { skip: skipTests }, () => {
  let db

  before(async () => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB)

    db = await createSqliteAdapter(TEST_DB)

    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE,
        is_admin INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Seed data
    db.run('INSERT INTO users (name, email) VALUES (?, ?)', ['Alice', 'alice@test.com'])
    db.run('INSERT INTO users (name, email) VALUES (?, ?)', ['Bob', 'bob@test.com'])
    db.run('INSERT INTO users (name, email, is_admin) VALUES (?, ?, ?)', ['Admin', 'admin@test.com', 1])
  })

  after(() => {
    if (db) db.close()
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB)
    if (existsSync(TEST_DB + '-wal')) unlinkSync(TEST_DB + '-wal')
    if (existsSync(TEST_DB + '-shm')) unlinkSync(TEST_DB + '-shm')
  })

  describe('SELECT queries', () => {
    test('get() returns all rows', async () => {
      const qb = new QueryBuilder(db, 'users')
      const users = await qb.get()

      assert.strictEqual(users.length, 3)
    })

    test('first() returns single row', async () => {
      const qb = new QueryBuilder(db, 'users')
      const user = await qb.first()

      assert.strictEqual(user.name, 'Alice')
    })

    test('find() returns row by ID', async () => {
      const qb = new QueryBuilder(db, 'users')
      const user = await qb.find(2)

      assert.strictEqual(user.name, 'Bob')
    })

    test('select() limits columns', async () => {
      const qb = new QueryBuilder(db, 'users')
      const user = await qb.select('name', 'email').first()

      assert.strictEqual(user.name, 'Alice')
      assert.strictEqual(user.email, 'alice@test.com')
      assert.strictEqual(user.id, undefined)
    })

    test('where() filters rows', async () => {
      const qb = new QueryBuilder(db, 'users')
      const users = await qb.where('is_admin', 1).get()

      assert.strictEqual(users.length, 1)
      assert.strictEqual(users[0].name, 'Admin')
    })

    test('where() with operator', async () => {
      const qb = new QueryBuilder(db, 'users')
      const users = await qb.where('id', '>', 1).get()

      assert.strictEqual(users.length, 2)
    })

    test('multiple where() clauses', async () => {
      const qb = new QueryBuilder(db, 'users')
      const users = await qb
        .where('is_admin', 0)
        .where('id', '>', 1)
        .get()

      assert.strictEqual(users.length, 1)
      assert.strictEqual(users[0].name, 'Bob')
    })

    test('orderBy() sorts results', async () => {
      const qb = new QueryBuilder(db, 'users')
      const users = await qb.orderBy('name', 'DESC').get()

      assert.strictEqual(users[0].name, 'Bob')
      assert.strictEqual(users[1].name, 'Alice')
      assert.strictEqual(users[2].name, 'Admin')
    })

    test('limit() restricts rows', async () => {
      const qb = new QueryBuilder(db, 'users')
      const users = await qb.limit(2).get()

      assert.strictEqual(users.length, 2)
    })

    test('offset() skips rows', async () => {
      const qb = new QueryBuilder(db, 'users')
      const users = await qb.offset(1).limit(2).get()

      assert.strictEqual(users.length, 2)
      assert.strictEqual(users[0].name, 'Bob')
    })

    test('count() returns row count', async () => {
      const qb = new QueryBuilder(db, 'users')
      const count = await qb.count()

      assert.strictEqual(count, 3)
    })

    test('count() with where', async () => {
      const qb = new QueryBuilder(db, 'users')
      const count = await qb.where('is_admin', 0).count()

      assert.strictEqual(count, 2)
    })

    test('exists() returns boolean', async () => {
      const qb1 = new QueryBuilder(db, 'users')
      assert.strictEqual(await qb1.where('email', 'alice@test.com').exists(), true)

      const qb2 = new QueryBuilder(db, 'users')
      assert.strictEqual(await qb2.where('email', 'nobody@test.com').exists(), false)
    })

    test('paginate() returns paginated results', async () => {
      const qb = new QueryBuilder(db, 'users')
      const result = await qb.orderBy('id').paginate(1, 2)

      assert.strictEqual(result.data.length, 2)
      assert.strictEqual(result.total, 3)
      assert.strictEqual(result.page, 1)
      assert.strictEqual(result.perPage, 2)
      assert.strictEqual(result.totalPages, 2)
    })
  })

  describe('INSERT queries', () => {
    test('insert() creates row', async () => {
      const qb = new QueryBuilder(db, 'users')
      const result = await qb.insert({ name: 'Charlie', email: 'charlie@test.com' })

      assert.ok(result.lastInsertRowid > 0)
      assert.strictEqual(result.changes, 1)

      const user = await new QueryBuilder(db, 'users').find(result.lastInsertRowid)
      assert.strictEqual(user.name, 'Charlie')
    })

    test('insert() respects fillable (only)', async () => {
      const qb = new QueryBuilder(db, 'users')
      const result = await qb
        .only('name', 'email')
        .insert({ name: 'Diana', email: 'diana@test.com', is_admin: 1 })

      const user = await new QueryBuilder(db, 'users').find(result.lastInsertRowid)
      assert.strictEqual(user.name, 'Diana')
      assert.strictEqual(user.is_admin, 0) // Default, not 1
    })

    test('insert() respects guarded (except)', async () => {
      const qb = new QueryBuilder(db, 'users')
      const result = await qb
        .except('id', 'is_admin')
        .insert({ name: 'Eve', email: 'eve@test.com', is_admin: 1 })

      const user = await new QueryBuilder(db, 'users').find(result.lastInsertRowid)
      assert.strictEqual(user.is_admin, 0) // Guarded
    })

    test('insert() throws on invalid column name', async () => {
      const qb = new QueryBuilder(db, 'users')

      await assert.rejects(
        () => qb.insert({ 'bad; sql': 'value' }),
        /Invalid identifier/
      )
    })

    test('insert() throws when no valid columns', async () => {
      const qb = new QueryBuilder(db, 'users')

      await assert.rejects(
        () => qb.only('name').insert({ email: 'test@test.com' }),
        /No valid columns/
      )
    })
  })

  describe('UPDATE queries', () => {
    test('update() modifies rows', async () => {
      const qb = new QueryBuilder(db, 'users')
      const result = await qb.where('name', 'Alice').update({ name: 'Alice Updated' })

      assert.strictEqual(result.changes, 1)

      const user = await new QueryBuilder(db, 'users').where('email', 'alice@test.com').first()
      assert.strictEqual(user.name, 'Alice Updated')

      // Reset
      await new QueryBuilder(db, 'users').where('email', 'alice@test.com').update({ name: 'Alice' })
    })

    test('update() respects fillable', async () => {
      const qb = new QueryBuilder(db, 'users')
      await qb
        .only('name')
        .where('id', 1)
        .update({ name: 'Test', is_admin: 1 })

      const user = await new QueryBuilder(db, 'users').find(1)
      assert.strictEqual(user.name, 'Test')
      assert.strictEqual(user.is_admin, 0) // Not updated

      // Reset
      await new QueryBuilder(db, 'users').where('id', 1).update({ name: 'Alice' })
    })
  })

  describe('DELETE queries', () => {
    test('delete() removes rows', async () => {
      // Insert a row to delete
      const insertQb = new QueryBuilder(db, 'users')
      const { lastInsertRowid } = await insertQb.insert({ name: 'ToDelete', email: 'delete@test.com' })

      const qb = new QueryBuilder(db, 'users')
      const result = await qb.where('id', lastInsertRowid).delete()

      assert.strictEqual(result.changes, 1)

      const user = await new QueryBuilder(db, 'users').find(lastInsertRowid)
      assert.strictEqual(user, undefined)
    })
  })

  describe('SQL injection prevention', () => {
    test('rejects malicious table name', () => {
      assert.throws(
        () => new QueryBuilder(db, 'users; DROP TABLE users'),
        /Invalid identifier/
      )
    })

    test('rejects malicious column in where()', async () => {
      const qb = new QueryBuilder(db, 'users')

      assert.throws(
        () => qb.where("id = 1; DROP TABLE users; --", 1),
        /Invalid identifier/
      )
    })

    test('rejects malicious column in select()', async () => {
      const qb = new QueryBuilder(db, 'users')

      assert.throws(
        () => qb.select("id; DROP TABLE users"),
        /Invalid identifier/
      )
    })

    test('rejects malicious column in orderBy()', async () => {
      const qb = new QueryBuilder(db, 'users')

      assert.throws(
        () => qb.orderBy("name; DROP TABLE users"),
        /Invalid identifier/
      )
    })

    test('rejects malicious key in insert data', async () => {
      const qb = new QueryBuilder(db, 'users')

      await assert.rejects(
        () => qb.insert({ "name = 'hacked' WHERE 1=1; --": 'value' }),
        /Invalid identifier/
      )
    })
  })

  describe('toSql()', () => {
    test('generates correct SELECT SQL', () => {
      const qb = new QueryBuilder(db, 'users', 'sqlite')
      qb.select('id', 'name').where('is_admin', 1).orderBy('name').limit(10)

      const sql = qb.toSql()

      assert.ok(sql.includes('SELECT "id", "name"'))
      assert.ok(sql.includes('FROM "users"'))
      assert.ok(sql.includes('WHERE "is_admin" = ?'))
      assert.ok(sql.includes('ORDER BY "name" ASC'))
      assert.ok(sql.includes('LIMIT 10'))
    })

    test('generates Postgres placeholders', () => {
      const qb = new QueryBuilder(db, 'users', 'postgres')
      qb.where('id', 1).where('name', 'test')

      const sql = qb.toSql()

      assert.ok(sql.includes('$1'))
      assert.ok(sql.includes('$2'))
    })
  })
})

// If tests are skipped, add a note
if (skipTests) {
  test('QueryBuilder tests skipped (no usable SQLite)', { skip: true }, () => {})
}
