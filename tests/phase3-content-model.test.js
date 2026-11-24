/**
 * Phase 3: custom post types, custom fields, custom taxonomies, the SSR
 * reference theme and oEmbed.
 *
 * The content model runs for real against a scratch SQLite database. It is
 * migrated in two steps — up to 037, then a few posts written the way the CMS
 * wrote them before content types existed, then 038–040 — because the promise
 * that matters most is that an existing site's posts come through as plain
 * posts and every existing read keeps returning exactly them.
 *
 * Templates and oEmbed are pure and are rendered directly. Wiring that needs a
 * running server (route order, the DISABLE_PUBLIC_SITE gate, feeds) is held in
 * place by reading the source, as the other suites here do.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert'
import { readFileSync, mkdtempSync, rmSync, mkdirSync, readdirSync, copyFileSync, existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf-8')
const load = (path) => import(pathToFileURL(join(ROOT, path)).href)

// The app's own sources import siblings without an extension, which the
// bundler resolves and Node does not. Resolve those to `.ts` for this suite
// only, so the real PublicContent and controllers can run here.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/i.test(specifier) && context.parentURL?.endsWith('.ts')) {
      const candidate = new URL(specifier + '.ts', context.parentURL)
      if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context)
    }
    return nextResolve(specifier, context)
  }
})

const scratch = mkdtempSync(join(tmpdir(), 'basicben-phase3-'))
const earlier = join(ROOT, 'tests', `.tmp-migrations-${process.pid}`)
process.env.DATABASE_URL = join(scratch, 'test.sqlite')
process.env.APP_KEY = 'phase-3-test-key-that-is-long-enough-to-sign-with'
process.env.SITE_URL = 'https://site.example'

let db, ContentType, Taxonomy, PublicContent, model, contentModel, paths
const ids = {}

const now = () => new Date().toISOString()

async function addPost(title, slug, extra = {}) {
  const row = { title, slug, content: `${title} body`, content_html: `<p>${title} body</p>`, user_id: ids.user, published: 1, created_at: now(), updated_at: now(), ...extra }
  const columns = Object.keys(row)
  const result = await db.run(
    `INSERT INTO posts (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    Object.values(row)
  )
  return Number(result.lastInsertRowid)
}

before(async () => {
  const { createMigrator } = await import('@basicbenframework/core/db/migrator')
    .catch(() => load('node_modules/@basicbenframework/core/src/db/migrator.js'))

  // Everything before this phase, in a directory of its own. Inside the repo,
  // so the migrations' own imports still resolve against node_modules.
  mkdirSync(earlier)
  for (const file of readdirSync(join(ROOT, 'db/migrations'))) {
    if (/^0(?:[0-2]\d|3[0-7])_/.test(file)) copyFileSync(join(ROOT, 'db/migrations', file), join(earlier, file))
  }
  await (await createMigrator(earlier)).migrate()

  db = await (await import('@basicbenframework/core/db')).getDb()
  const user = await db.run(
    'INSERT INTO users (name, email, password, role, email_verified) VALUES (?, ?, ?, ?, ?)',
    ['Ada', 'ada@example.test', 'x', 'admin', 1]
  )
  ids.user = Number(user.lastInsertRowid)
  ids.oldLive = await addPost('Old live post', 'old-live')
  ids.oldDraft = await addPost('Old draft', 'old-draft', { published: 0 })

  // Then this phase, on top of a site that already has content.
  await (await createMigrator()).migrate()

  paths = await load('src/helpers/content-paths.ts')
  model = await load('src/models/ContentType.ts')
  ContentType = model.ContentType
  ;({ Taxonomy } = await load('src/models/Taxonomy.ts'))
  ;({ PublicContent } = await load('src/models/PublicContent.ts'))
  contentModel = await load('src/helpers/content-model.ts')
})

after(() => {
  rmSync(scratch, { recursive: true, force: true })
  rmSync(earlier, { recursive: true, force: true })
})

describe('existing content survives the migrations', () => {
  test('every existing post is backfilled as a plain post with no fields', async () => {
    const rows = await db.all('SELECT id, post_type, fields FROM posts ORDER BY id')
    assert.deepStrictEqual(rows.map((row) => row.post_type), ['post', 'post'])
    assert.ok(rows.every((row) => row.fields === null))
  })

  test('the built-in post type exists, at /blog, and cannot be deleted', async () => {
    const post = await ContentType.findByKey('post')
    assert.ok(post)
    assert.strictEqual(post.builtin, true)
    assert.strictEqual(post.route_base, '/blog')
    assert.strictEqual(post.public, true)
  })

  test('a new row without a type is a post', async () => {
    const id = await addPost('Written the old way', 'old-way')
    const row = await db.get('SELECT post_type FROM posts WHERE id = ?', [id])
    assert.strictEqual(row.post_type, 'post')
  })

  test('the public API reads posts exactly as before', async () => {
    const posts = await PublicContent.posts({})
    assert.ok(posts.posts.some((post) => post.slug === 'old-live'))
    assert.ok(!posts.posts.some((post) => post.slug === 'old-draft'))
    const one = posts.posts.find((post) => post.slug === 'old-live')
    assert.strictEqual(one.type, 'post')
    assert.deepStrictEqual(one.fields, {})
    assert.deepStrictEqual(one.terms, {})
  })
})

describe('content type validation', () => {
  test('a valid type defaults its route base from its key', () => {
    const result = model.validateContentType({ key: 'podcast_episode', singular_label: 'Episode', plural_label: 'Episodes' })
    assert.ok('values' in result)
    assert.strictEqual(result.values.route_base, '/podcast-episode')
    assert.strictEqual(result.values.public, true)
  })

  test('reserved and malformed keys are refused', () => {
    for (const key of ['post', 'page', 'any', 'my-type', '1x', '']) {
      const result = model.validateContentType({ key, singular_label: 'A', plural_label: 'B' })
      assert.ok('errors' in result && result.errors.key, `refused ${key}`)
    }
  })

  test('route bases cannot shadow the site or the admin', () => {
    for (const base of ['/api', '/admin', '/feed', '/blog', '/category', '/a/b', '/x y']) {
      assert.strictEqual(paths.normalizeRouteBase(base), null, base)
    }
    assert.strictEqual(paths.normalizeRouteBase('Recipes/'), '/recipes')
  })

  test('the built-in type keeps its route base and visibility whatever is sent', async () => {
    const post = await ContentType.findByKey('post')
    const result = model.validateContentType({ route_base: '/articles', public: false, plural_label: 'Articles' }, post)
    assert.strictEqual(result.values.route_base, '/blog')
    assert.strictEqual(result.values.public, true)
    assert.strictEqual(result.values.plural_label, 'Articles')
  })

  test('field definitions need unique keys and select options', () => {
    assert.ok('errors' in model.validateFieldDefinitions([{ key: 'a', label: 'A', type: 'text' }, { key: 'a', label: 'B', type: 'text' }]))
    assert.ok('errors' in model.validateFieldDefinitions([{ key: 'size', label: 'Size', type: 'select', options: [] }]))
    assert.ok('errors' in model.validateFieldDefinitions([{ key: 'x', label: 'X', type: 'html' }]))
    const ok = model.validateFieldDefinitions([{ key: 'size', label: 'Size', type: 'select', options: ['S', 'M'] }])
    assert.deepStrictEqual(ok.fields[0].options, ['S', 'M'])
  })
})

describe('custom field values', () => {
  const defs = [
    { key: 'servings', label: 'Servings', type: 'number', options: [], required: true, help_text: null },
    { key: 'cooked_on', label: 'Cooked on', type: 'date', options: [], required: false, help_text: null },
    { key: 'vegan', label: 'Vegan', type: 'boolean', options: [], required: false, help_text: null },
    { key: 'course', label: 'Course', type: 'select', options: ['Main', 'Dessert'], required: false, help_text: null },
    { key: 'source', label: 'Source', type: 'url', options: [], required: false, help_text: null }
  ]

  test('values are coerced to their type and unknown keys dropped', () => {
    const result = model.validateFieldValues(defs, { servings: '4', cooked_on: '2026-05-01', vegan: 'true', course: 'Main', source: 'https://example.test/r', extra: 'x' })
    assert.deepStrictEqual(result.values, { servings: 4, cooked_on: '2026-05-01', vegan: true, course: 'Main', source: 'https://example.test/r' })
  })

  test('bad values and missing required ones are refused', () => {
    const result = model.validateFieldValues(defs, { servings: 'lots', course: 'Starter', source: 'javascript:alert(1)', cooked_on: 'soon' })
    // Keyed `fields.<key>`, the way the editor's form errors are addressed.
    assert.deepStrictEqual(Object.keys(result.errors).sort(), ['fields.cooked_on', 'fields.course', 'fields.servings', 'fields.source'])
    assert.ok(model.validateFieldValues(defs, {}).errors['fields.servings'], 'required')
  })
})

describe('custom types end to end', () => {
  before(async () => {
    const checked = model.validateContentType({
      key: 'recipe',
      singular_label: 'Recipe',
      plural_label: 'Recipes',
      supports: { tags: false, comments: false },
      fields: [
        { key: 'servings', label: 'Servings', type: 'number', required: true },
        { key: 'secret', label: 'Secret', type: 'text' }
      ]
    })
    ids.recipeType = (await ContentType.create(checked.values)).id

    const draftType = model.validateContentType({ key: 'internal', singular_label: 'Note', plural_label: 'Notes', public: false })
    await ContentType.create(draftType.values)

    const { validateTaxonomy } = await load('src/models/Taxonomy.ts')
    const cuisine = validateTaxonomy({ key: 'cuisine', singular_label: 'Cuisine', plural_label: 'Cuisines', content_types: ['recipe'] })
    ids.cuisine = (await Taxonomy.create(cuisine.values)).id
    ids.thai = (await Taxonomy.createTerm(ids.cuisine, { name: 'Thai', slug: 'thai', description: null, parent_id: null })).id
    ids.greek = (await Taxonomy.createTerm(ids.cuisine, { name: 'Greek', slug: 'greek', description: null, parent_id: null })).id

    const typed = await contentModel.typeAndFields({ post_type: 'recipe', fields: { servings: '2', secret: 'hi' } }, null)
    ids.recipe = await addPost('Green curry', 'green-curry', typed.values)
    await contentModel.saveTerms(ids.recipe, { term_ids: [ids.thai] })
    ids.note = await addPost('Hidden note', 'hidden-note', { post_type: 'internal' })
  })

  test('the built-in type cannot be deleted through the API', async () => {
    const { ContentTypeController } = await load('src/controllers/ContentTypeController.ts')
    const res = { status: 200, json(data, status = 200) { this.body = data; this.status = status } }
    const post = await ContentType.findByKey('post')
    await ContentTypeController.destroy({ params: { id: String(post.id) }, user: { id: ids.user, role: 'admin' } }, res)
    assert.strictEqual(res.status, 422)
    assert.ok(await ContentType.findByKey('post'))
  })

  test('a type with posts cannot be deleted', async () => {
    const { ContentTypeController } = await load('src/controllers/ContentTypeController.ts')
    const res = { status: 200, json(data, status = 200) { this.body = data; this.status = status } }
    await ContentTypeController.destroy({ params: { id: 'recipe' }, user: { id: ids.user, role: 'admin' } }, res)
    assert.strictEqual(res.status, 409)
  })

  test('an unknown type and invalid fields are refused on save', async () => {
    assert.ok('errors' in await contentModel.typeAndFields({ post_type: 'nope' }, null))
    assert.ok('errors' in await contentModel.typeAndFields({ post_type: 'recipe', fields: {} }, null))
  })

  test('a body that says nothing about types leaves type and fields alone', async () => {
    const existing = await db.get('SELECT id, post_type, fields FROM posts WHERE id = ?', [ids.recipe])
    assert.deepStrictEqual(await contentModel.typeAndFields({ title: 'x' }, existing), { values: {} })
  })

  test('changing to a type without fields clears them', async () => {
    const existing = await db.get('SELECT id, post_type, fields FROM posts WHERE id = ?', [ids.recipe])
    const result = await contentModel.typeAndFields({ post_type: 'post' }, existing)
    assert.deepStrictEqual(result.values, { post_type: 'post', fields: null })
  })

  test('the default listing is still posts only', async () => {
    const posts = await PublicContent.posts({})
    assert.ok(!posts.posts.some((post) => post.slug === 'green-curry'))
    assert.ok(!posts.posts.some((post) => post.slug === 'hidden-note'))
  })

  test('?type= lists a public type, with its fields and terms', async () => {
    const recipes = await PublicContent.posts({ type: 'recipe' })
    assert.deepStrictEqual(recipes.posts.map((post) => post.slug), ['green-curry'])
    const [curry] = recipes.posts
    assert.strictEqual(curry.type, 'recipe')
    assert.deepStrictEqual(curry.fields, { servings: 2, secret: 'hi' })
    assert.deepStrictEqual(curry.terms.cuisine.map((term) => term.slug), ['thai'])
  })

  test('a private type is never listed, even by name or with type=any', async () => {
    assert.strictEqual((await PublicContent.posts({ type: 'internal' })).posts.length, 0)
    assert.ok(!(await PublicContent.posts({ type: 'any' })).posts.some((post) => post.slug === 'hidden-note'))
    assert.strictEqual(await PublicContent.post('hidden-note', 'html', { type: 'internal' }), null)
  })

  test('a single entry is found under its own type only', async () => {
    assert.strictEqual(await PublicContent.post('green-curry'), null, 'not a post')
    assert.strictEqual((await PublicContent.post('green-curry', 'html', { type: 'recipe' })).title, 'Green curry')
  })

  test('taxonomy filters narrow a listing, both spellings', async () => {
    const { taxonomyFilters } = await load('src/models/Taxonomy.ts')
    assert.deepStrictEqual(taxonomyFilters({ 'taxonomy[cuisine]': 'thai' }), { cuisine: 'thai' })
    // The framework parses queries flat, so the bracketed form is a key of its own.
    assert.deepStrictEqual(taxonomyFilters({ "taxonomy[Bad Key]": "x", tax: "cuisine:thai,nope" }), { cuisine: "thai" })
    assert.deepStrictEqual(taxonomyFilters({ tax: 'cuisine:thai' }), { cuisine: 'thai' })

    assert.strictEqual((await PublicContent.posts({ type: 'recipe', taxonomy: { cuisine: 'thai' } })).posts.length, 1)
    assert.strictEqual((await PublicContent.posts({ type: 'recipe', taxonomy: { cuisine: 'greek' } })).posts.length, 0)
  })

  test('terms of a taxonomy not attached to the type are dropped on sync', async () => {
    const other = await addPost('Plain post', 'plain-post')
    await Taxonomy.syncPostTerms(other, [ids.thai])
    assert.deepStrictEqual(await Taxonomy.termIdsFor(other), [])

    await Taxonomy.syncPostTerms(ids.recipe, [ids.greek, ids.thai, 99999])
    assert.deepStrictEqual((await Taxonomy.termIdsFor(ids.recipe)).sort(), [ids.thai, ids.greek].sort())
  })

  test('entry paths follow the route base; posts keep /blog', async () => {
    assert.strictEqual(await contentModel.publicPathOf({ id: 1, slug: 'green-curry', post_type: 'recipe' }), '/recipe/green-curry')
    assert.strictEqual(await contentModel.publicPathOf({ id: 1, slug: 'hello', post_type: 'post' }), '/blog/hello')
  })

  test('a moved custom entry gets a redirect at its own path', async () => {
    const { redirectIfSlugChanged } = await load('src/helpers/redirects.ts')
    const before = { id: ids.recipe, slug: 'green-curry', published: 1, deleted_at: null, post_type: 'recipe' }
    await redirectIfSlugChanged('post', before, { ...before, slug: 'thai-green-curry' })
    const row = await db.get("SELECT * FROM redirects WHERE from_path = '/recipe/green-curry'")
    assert.ok(row, 'redirect recorded')
    assert.strictEqual(row.to_path, '/recipe/thai-green-curry')
  })
})

describe('wiring', () => {
  test('feeds stay posts-only; the sitemap includes public custom types', () => {
    const feeds = read('src/controllers/FeedController.ts')
    assert.match(feeds, /p\.post_type = 'post'/)
    assert.match(feeds, /ContentType\.all/)
  })

  test('the public API takes type and taxonomy filters and lists types and taxonomies', () => {
    const v1 = read('src/routes/api/v1.ts')
    assert.match(v1, /\/api\/v1\/types/)
    assert.match(v1, /\/api\/v1\/taxonomies\/:key\/terms/)
    assert.match(read('src/controllers/PublicApiController.ts'), /taxonomyFilters\(/)
  })

  test('migrations stay within this phase\'s numbers', () => {
    const mine = readdirSync(join(ROOT, 'db/migrations')).filter((file) => /^03[89]_|^040_/.test(file))
    assert.deepStrictEqual(mine.sort(), ['038_create_content_types.js', '039_create_content_type_fields.js', '040_create_taxonomies.js'])
  })
})
