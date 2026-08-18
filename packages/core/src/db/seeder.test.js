/**
 * Tests for database seeder
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const TEST_SEEDS_DIR = './test-seeds'

describe('Seeder', () => {
  let createSeeder

  before(async () => {
    // Create test seeds directory
    if (!existsSync(TEST_SEEDS_DIR)) {
      mkdirSync(TEST_SEEDS_DIR, { recursive: true })
    }

    // Create test seed files
    writeFileSync(join(TEST_SEEDS_DIR, 'users.js'), `
      export async function seed(db) {
        // Mock seed - just track that it ran
        global.testSeedRan = global.testSeedRan || []
        global.testSeedRan.push('users')
      }
    `)

    writeFileSync(join(TEST_SEEDS_DIR, 'posts.js'), `
      export async function seed(db) {
        global.testSeedRan = global.testSeedRan || []
        global.testSeedRan.push('posts')
      }
    `)

    writeFileSync(join(TEST_SEEDS_DIR, 'default_export.js'), `
      export default async function(db) {
        global.testSeedRan = global.testSeedRan || []
        global.testSeedRan.push('default_export')
      }
    `)

    // Import seeder
    const module = await import('./seeder.js')
    createSeeder = module.createSeeder
  })

  after(() => {
    // Clean up test seeds directory
    if (existsSync(TEST_SEEDS_DIR)) {
      rmSync(TEST_SEEDS_DIR, { recursive: true })
    }
    // Clean up global tracker
    delete global.testSeedRan
  })

  test('list() returns available seed files', async () => {
    const seeder = await createSeeder(TEST_SEEDS_DIR)
    const list = seeder.list()

    assert.ok(Array.isArray(list))
    assert.ok(list.includes('users'))
    assert.ok(list.includes('posts'))
    assert.ok(list.includes('default_export'))
  })

  test('run() executes specific seed', async () => {
    global.testSeedRan = []

    const seeder = await createSeeder(TEST_SEEDS_DIR)
    const result = await seeder.run('users')

    assert.deepStrictEqual(result.ran, ['users'])
    assert.ok(global.testSeedRan.includes('users'))
    assert.ok(!global.testSeedRan.includes('posts'))
  })

  test('run() works with default export', async () => {
    global.testSeedRan = []

    const seeder = await createSeeder(TEST_SEEDS_DIR)
    const result = await seeder.run('default_export')

    assert.deepStrictEqual(result.ran, ['default_export'])
    assert.ok(global.testSeedRan.includes('default_export'))
  })

  test('runAll() executes all seeds in order', async () => {
    global.testSeedRan = []

    const seeder = await createSeeder(TEST_SEEDS_DIR)
    const result = await seeder.runAll()

    assert.strictEqual(result.ran.length, 3)
    // Should run in alphabetical order
    assert.strictEqual(result.ran[0], 'default_export')
    assert.strictEqual(result.ran[1], 'posts')
    assert.strictEqual(result.ran[2], 'users')
  })

  test('run() throws for non-existent seed', async () => {
    const seeder = await createSeeder(TEST_SEEDS_DIR)

    await assert.rejects(
      () => seeder.run('nonexistent'),
      /Seed file not found/
    )
  })

  test('returns empty result for empty directory', async () => {
    const emptyDir = './test-empty-seeds'
    mkdirSync(emptyDir, { recursive: true })

    try {
      const seeder = await createSeeder(emptyDir)
      const result = await seeder.runAll()

      assert.strictEqual(result.ran.length, 0)
      assert.ok(result.message)
    } finally {
      rmSync(emptyDir, { recursive: true })
    }
  })

  test('returns empty result for non-existent directory', async () => {
    const seeder = await createSeeder('./nonexistent-seeds-dir')
    const result = await seeder.runAll()

    assert.strictEqual(result.ran.length, 0)
  })
})
