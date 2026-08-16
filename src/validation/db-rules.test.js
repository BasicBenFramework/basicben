/**
 * Tests for database validation rules (unique, exists)
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert'
import { unlinkSync, existsSync } from 'node:fs'

const TEST_DB = './test-validation-db.db'

// node:sqlite is built in on the supported Node versions, so this only guards
// against an environment that genuinely cannot open a database.
let skipTests = false
let db, validate, rules

try {
  // Set up test database
  const { createSqliteAdapter } = await import('../db/adapters/sqlite.js')
  const testDb = await createSqliteAdapter(TEST_DB)

  // Create test tables
  testDb.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      name TEXT
    )
  `)

  testDb.exec(`
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL
    )
  `)

  // Seed test data
  testDb.run('INSERT INTO users (email, name) VALUES (?, ?)', ['alice@test.com', 'Alice'])
  testDb.run('INSERT INTO users (email, name) VALUES (?, ?)', ['bob@test.com', 'Bob'])
  testDb.run('INSERT INTO categories (name, slug) VALUES (?, ?)', ['Technology', 'tech'])
  testDb.run('INSERT INTO categories (name, slug) VALUES (?, ?)', ['Sports', 'sports'])

  testDb.close()

  // Mock the db module to use our test database
  const { resetDb } = await import('../db/index.js')
  resetDb()

  // Set environment to use test db
  process.env.DATABASE_URL = TEST_DB

  // Now import validation (which imports db)
  const validationModule = await import('./index.js')
  validate = validationModule.validate
  rules = validationModule.rules

  // Get db reference for cleanup
  const dbModule = await import('../db/index.js')
  db = dbModule.db
} catch (err) {
  skipTests = true
  console.log('Skipping db-rules tests:', err.message)
}

describe('rules.unique', { skip: skipTests }, () => {
  test('passes when value is unique', async () => {
    const result = await validate(
      { email: 'newuser@test.com' },
      { email: [rules.unique('users')] }
    )

    assert.ok(result.passes())
  })

  test('fails when value already exists', async () => {
    const result = await validate(
      { email: 'alice@test.com' },
      { email: [rules.unique('users')] }
    )

    assert.ok(result.fails())
    assert.ok(result.first('email').includes('already been taken'))
  })

  test('uses custom column name', async () => {
    const result = await validate(
      { slug: 'tech' },
      { slug: [rules.unique('categories', 'slug')] }
    )

    assert.ok(result.fails())
  })

  test('excludes ID for updates', async () => {
    // Alice (id=1) should be able to keep her own email
    const result = await validate(
      { email: 'alice@test.com' },
      { email: [rules.unique('users', 'email', 1)] }
    )

    assert.ok(result.passes())
  })

  test('still fails if different user has email', async () => {
    // Alice (id=1) cannot use Bob's email
    const result = await validate(
      { email: 'bob@test.com' },
      { email: [rules.unique('users', 'email', 1)] }
    )

    assert.ok(result.fails())
  })

  test('skips on empty value', async () => {
    const result = await validate(
      { email: '' },
      { email: [rules.unique('users')] }
    )

    assert.ok(result.passes())
  })
})

describe('rules.exists', { skip: skipTests }, () => {
  test('passes when value exists', async () => {
    const result = await validate(
      { user_id: 1 },
      { user_id: [rules.exists('users')] }
    )

    assert.ok(result.passes())
  })

  test('fails when value does not exist', async () => {
    const result = await validate(
      { user_id: 999 },
      { user_id: [rules.exists('users')] }
    )

    assert.ok(result.fails())
    assert.ok(result.first('user_id').includes('does not exist'))
  })

  test('uses custom column name', async () => {
    const result = await validate(
      { category: 'tech' },
      { category: [rules.exists('categories', 'slug')] }
    )

    assert.ok(result.passes())
  })

  test('fails with non-existent slug', async () => {
    const result = await validate(
      { category: 'nonexistent' },
      { category: [rules.exists('categories', 'slug')] }
    )

    assert.ok(result.fails())
  })

  test('skips on empty value', async () => {
    const result = await validate(
      { user_id: '' },
      { user_id: [rules.exists('users')] }
    )

    assert.ok(result.passes())
  })
})

describe('combining db rules with other rules', { skip: skipTests }, () => {
  test('required + unique', async () => {
    const result = await validate(
      { email: '' },
      { email: [rules.required, rules.email, rules.unique('users')] }
    )

    assert.ok(result.fails())
    assert.strictEqual(result.first('email'), 'email is required')
  })

  test('email format checked before unique', async () => {
    const result = await validate(
      { email: 'not-an-email' },
      { email: [rules.required, rules.email, rules.unique('users')] }
    )

    assert.ok(result.fails())
    assert.ok(result.first('email').includes('valid email'))
  })

  test('required + exists', async () => {
    const result = await validate(
      { user_id: '' },
      { user_id: [rules.required, rules.exists('users')] }
    )

    assert.ok(result.fails())
    assert.strictEqual(result.first('user_id'), 'user_id is required')
  })
})

// Cleanup
after(async () => {
  if (!skipTests && db) {
    await db.close()
  }
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB)
  if (existsSync(TEST_DB + '-wal')) unlinkSync(TEST_DB + '-wal')
  if (existsSync(TEST_DB + '-shm')) unlinkSync(TEST_DB + '-shm')
})

// Skip message
if (skipTests) {
  test('Database validation tests skipped (no usable SQLite)', { skip: true }, () => {})
}
