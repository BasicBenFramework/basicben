/**
 * Categories are many-to-many, and the editor's selection actually persists.
 *
 * Two faults, found together. The schema allowed a post one category, so
 * importing from anywhere that allows several meant choosing what to lose — on
 * the first real migration that demoted 67 of 83 categories to tags, which kept
 * the words and lost the meaning.
 *
 * The worse one was quieter: `store` and `update` read only title, content and
 * published. The editor sent `category_id` and `tags` with every save and the
 * server dropped both on the floor. Nothing errored, so the taxonomy UI looked
 * like it worked and had never once written a row — every category and tag in
 * the database had been put there by the importer.
 *
 * Behaviour was verified against a running server: a post created with three
 * categories keeps all three, filtering finds it by a non-primary one,
 * unchecking removes it, omitting the key leaves the selection alone, and an
 * empty array clears it.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf-8')

describe('a post can have several categories', () => {
  test('there is a join table, indexed both ways', () => {
    const migration = read('db/migrations/019_create_post_categories.js')

    assert.match(migration, /CREATE TABLE post_categories/)
    assert.match(migration, /PRIMARY KEY \(post_id, category_id\)/)
    assert.match(migration, /idx_post_categories_post/)
    assert.match(migration, /idx_post_categories_category/)
  })

  test('existing rows are backfilled, so nothing needs re-importing', () => {
    const migration = read('db/migrations/019_create_post_categories.js')

    assert.match(migration, /INSERT INTO post_categories[\s\S]*SELECT id, category_id FROM posts/)
  })

  test('the public shape returns an array, not one category', () => {
    const model = read('src/models/PublicContent.ts')

    assert.match(model, /categories: Array<\{ id: number; name: string; slug: string \}>/)
    assert.doesNotMatch(model, /^\s*category: \{ id: number/m)
  })

  test('filtering matches any of a post\'s categories, not only the primary', () => {
    // A post filed under both "AI" and "Jobs" belongs in either listing. The
    // old query joined posts.category_id, so it only ever matched the first.
    const model = read('src/models/PublicContent.ts')

    assert.match(model, /SELECT pc\.post_id FROM post_categories pc/)
  })

  test('counts come from the join table', () => {
    const model = read('src/models/PublicContent.ts')

    assert.match(model, /LEFT JOIN post_categories pc ON pc\.category_id = c\.id/)
  })

  test('categories and tags are fetched per page, not per post', () => {
    // The N+1 is invisible on a seeded database and painful on a real one.
    const model = read('src/models/PublicContent.ts')

    assert.match(model, /WHERE pc\.post_id IN \(\$\{placeholders\}\)/)
    assert.match(model, /WHERE pt\.post_id IN \(\$\{placeholders\}\)/)
  })
})

describe('the editor selection reaches the database', () => {
  const controller = read('src/controllers/PostController.ts')

  test('both create and update persist it', () => {
    // It was accepted and silently discarded by both.
    const stores = controller.match(/saveTaxonomy\(/g) ?? []

    assert.ok(stores.length >= 3, 'store, update and the helper itself should all appear')
  })

  test('the set is replaced, not merged', () => {
    // A merge makes unchecking a box do nothing, which is the kind of bug
    // people re-report for months.
    const model = read('src/models/Post.ts')

    assert.match(model, /DELETE FROM post_categories WHERE post_id = \?/)
    assert.match(model, /DELETE FROM post_tags WHERE post_id = \?/)
  })

  test('an absent key leaves the selection alone; an empty array clears it', () => {
    // Otherwise renaming a post would silently strip its taxonomy.
    assert.match(controller, /Array\.isArray\(payload\.category_ids\)/)
  })

  test('the primary category is kept in step', () => {
    const model = read('src/models/Post.ts')

    assert.match(model, /UPDATE posts SET category_id = \?/)
  })

  test('the editor is told what is currently selected', () => {
    // Without this the boxes come up empty on every edit and saving wipes them.
    assert.match(controller, /category_ids: taxonomy\.categories/)
    assert.match(controller, /tag_ids: taxonomy\.tags/)
  })

  test('the editor sends every selected category', () => {
    const editor = read('src/client/pages/admin/PostEditor.tsx')

    assert.match(editor, /category_ids: \[\] as number\[\]/)
    assert.match(editor, /handleCategoryToggle/)
  })
})

describe('the importer keeps the whole taxonomy', () => {
  const importer = read('scripts/import-wordpress.mjs')

  test('every category is linked, not just the first', () => {
    assert.match(importer, /for \(const term of wpCategories\)/)
    assert.match(importer, /INSERT INTO post_categories/)
  })

  test('categories are no longer demoted to tags', () => {
    assert.doesNotMatch(importer, /wpCategories\.slice\(1\)/)
  })

  test('links are rebuilt on re-run rather than accumulating', () => {
    assert.match(importer, /DELETE FROM post_categories WHERE post_id = \?/)
  })
})
