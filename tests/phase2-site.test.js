/**
 * Site settings, navigation menus and redirects.
 *
 * The validators and the tree builder are pure and imported directly. The
 * redirect rules — chain collapsing, loop refusal, releasing a path that is
 * live again — are a function of what the table holds, so they run against a
 * real in-memory SQLite database (Node's own `node:sqlite`) created by the
 * real migration. Wiring — who may call what, and that the controllers call
 * the helpers — is checked in the source, the way the rest of this suite does.
 */

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

import {
  isSafeLinkUrl,
  normalizeRedirectSource,
  normalizeRedirectTarget,
  postPath,
  pagePath,
  categoryPath
} from '../src/helpers/content-paths.ts'
import { validateSettings, isTimeZone, canonicalLocale, SETTINGS } from '../src/helpers/site-settings.ts'
import { buildPublicTree, validateMenuItem, validateReorder } from '../src/models/Menu.ts'
import { Redirect, resolveChains, validateRedirect } from '../src/models/Redirect.ts'
import * as redirectsMigration from '../db/migrations/029_create_redirects.js'
import * as menusMigration from '../db/migrations/028_create_navigation_menus.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf-8')

/** The adapter surface the models use, over node:sqlite. */
function memoryDb() {
  const sqlite = new DatabaseSync(':memory:')
  return {
    sqlite,
    exec: async (sql) => sqlite.exec(sql),
    get: async (sql, params = []) => sqlite.prepare(sql).get(...params),
    all: async (sql, params = []) => sqlite.prepare(sql).all(...params),
    run: async (sql, params = []) => sqlite.prepare(sql).run(...params)
  }
}

const grammar = {
  autoIncrementPrimaryKey: () => 'INTEGER PRIMARY KEY AUTOINCREMENT',
  timestampType: () => 'TEXT',
  dropTable: (name) => `DROP TABLE IF EXISTS ${name}`
}

describe('link safety', () => {
  test('menus accept http(s), root-relative paths and mailto only', () => {
    for (const ok of ['https://example.com', 'http://example.com/a?b=1', '/about', '/blog/x#top', 'mailto:hi@example.com', 'MAILTO:hi@example.com']) {
      assert.ok(isSafeLinkUrl(ok), ok)
    }

    for (const bad of [
      'javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)',
      'data:text/html,<script>', 'vbscript:x', '//evil.example', '/\\evil.example', 'about', '',
      'https://exa mple.com', '/a\nb', 'mailto:', 'ftp://example.com', 42, null
    ]) {
      assert.ok(!isSafeLinkUrl(bad), `accepted ${JSON.stringify(bad)}`)
    }
  })

  test('redirect sources are normalised paths', () => {
    assert.strictEqual(normalizeRedirectSource('/old/'), '/old')
    assert.strictEqual(normalizeRedirectSource('old'), '/old')
    assert.strictEqual(normalizeRedirectSource('/old?x=1#y'), '/old')
    assert.strictEqual(normalizeRedirectSource('https://site.example/old/'), '/old')
    assert.strictEqual(normalizeRedirectSource('/'), '/')
    assert.strictEqual(normalizeRedirectSource('//evil.example'), null)
    assert.strictEqual(normalizeRedirectSource('/a b'), null)
  })

  test('redirect targets are local paths or http(s), never another scheme', () => {
    assert.strictEqual(normalizeRedirectTarget('/new/'), '/new')
    assert.strictEqual(normalizeRedirectTarget('/search/?q=x'), '/search?q=x')
    assert.strictEqual(normalizeRedirectTarget('https://elsewhere.example/page'), 'https://elsewhere.example/page')
    assert.strictEqual(normalizeRedirectTarget('javascript:alert(1)'), null)
    assert.strictEqual(normalizeRedirectTarget('//evil.example'), null)
  })

  test('public paths match the ones feeds and the sitemap hand out', () => {
    assert.strictEqual(postPath('hello'), '/blog/hello')
    assert.strictEqual(postPath(null, 7), '/blog/7')
    assert.strictEqual(pagePath('about'), '/about')
    assert.strictEqual(categoryPath('news'), '/category/news')

    const feed = read('src/controllers/FeedController.ts')
    assert.match(feed, /\/blog\/\$\{post\.slug \|\| post\.id\}/)
    assert.match(feed, /\/category\/\$\{cat\.slug\}/)
  })
})

describe('site settings', () => {
  test('unknown keys are refused, and nothing is written', () => {
    const result = validateSettings({ site_name: 'Mine', alow_comments: 'true' })
    assert.deepStrictEqual(result, { errors: { alow_comments: ['Unknown setting'] } })
  })

  test('every setting the code reads is in the allowlist', () => {
    for (const key of ['site_name', 'site_description', 'posts_per_page', 'allow_comments', 'moderate_comments', 'public_api', 'webhook_urls', 'robots_txt']) {
      assert.ok(key in SETTINGS, key)
    }
  })

  test('values are checked per key and stored in their group', () => {
    const ok = validateSettings({
      allow_comments: true,
      posts_per_page: '25',
      timezone: 'Europe/London',
      locale: 'en-gb',
      site_logo: '/uploads/logo.svg',
      default_social_image: 'https://cdn.example/og.png',
      webhook_urls: 'https://a.example/hook\n\nhttps://b.example/hook'
    })

    assert.ok('values' in ok)
    assert.deepStrictEqual(ok.values.allow_comments, { value: 'true', group: 'discussion' })
    assert.deepStrictEqual(ok.values.posts_per_page, { value: '25', group: 'reading' })
    assert.strictEqual(ok.values.locale.value, 'en-GB', 'locale is canonicalised')
    assert.strictEqual(ok.values.timezone.group, 'locale')

    const bad = validateSettings({
      site_name: '  ',
      posts_per_page: '0',
      allow_comments: 'yes',
      timezone: 'Mars/Olympus',
      locale: 'not a locale!',
      site_icon: 'javascript:alert(1)',
      webhook_urls: 'https://ok.example\nftp://nope.example'
    })

    assert.deepStrictEqual(Object.keys(bad.errors).sort(), [
      'allow_comments', 'locale', 'posts_per_page', 'site_icon', 'site_name', 'timezone', 'webhook_urls'
    ])
  })

  test('time zones are IANA names, not offsets', () => {
    assert.ok(isTimeZone('UTC'))
    assert.ok(isTimeZone('America/Argentina/Buenos_Aires'))
    assert.ok(!isTimeZone('+01:00'))
    assert.ok(!isTimeZone('Nowhere/Special'))
    assert.strictEqual(canonicalLocale('zh-hant-tw'), 'zh-Hant-TW')
    assert.strictEqual(canonicalLocale('!!'), null)
  })

  test('code injection is stored verbatim — it is meant to carry scripts', () => {
    const html = '<script async src="https://analytics.example/a.js"></script>'
    const result = validateSettings({ code_injection_head: html, code_injection_foot: '' })
    assert.strictEqual(result.values.code_injection_head.value, html)
  })

  test('every settings route requires settings.manage, and writes are validated', () => {
    const routes = read('src/routes/api/settings.ts')
    for (const line of routes.split('\n').filter(l => /router\.(put|delete)\(/.test(l))) {
      assert.match(line, /auth, requireCapability\('settings\.manage'\)/, line)
    }

    const controller = read('src/controllers/SettingsController.ts')
    assert.match(controller, /async update[\s\S]*?validateSettings\(settings\)/)
    assert.match(controller, /async set[\s\S]*?validateSettings\(/)
    assert.match(controller, /async updateSiteInfo[\s\S]*?validateSettings\(/)
  })

  test('the site URL is a setting that SITE_URL overrides', () => {
    // The URL in use is reported whichever source it comes from, and the
    // environment variable, when set, locks the setting (helpers/config.ts).
    assert.match(read('src/controllers/SettingsController.ts'), /site_url: siteUrl\(req\)/)
    assert.match(read('src/helpers/site-settings.ts'), /\bsite_url: \{ group: 'general', check: httpUrlOrBlank \}/)
    assert.match(read('src/helpers/config.ts'), /env: 'SITE_URL', setting: 'site_url'/)
    assert.match(read('src/helpers/site.ts'), /configValue\('SITE_URL'\) \|\| process\.env\.APP_URL/)
  })
})

describe('navigation menus', () => {
  const item = (overrides) => ({
    menu_id: 1, parent_id: null, url: null, target_type: null, target_id: null,
    open_in_new_tab: 0, sort_order: 0, ...overrides
  })

  test('linked content resolves to its current path; hidden content drops out with its children', () => {
    const items = [
      item({ id: 1, label: 'Home', url: '/', sort_order: 0 }),
      item({ id: 2, label: 'About', target_type: 'page', target_id: 10, sort_order: 1 }),
      item({ id: 3, label: 'Team', target_type: 'page', target_id: 11, parent_id: 2, sort_order: 0 }),
      item({ id: 4, label: 'Draft', target_type: 'post', target_id: 99, sort_order: 2 }),
      item({ id: 5, label: 'Under draft', url: '/x', parent_id: 4, sort_order: 0 }),
      item({ id: 6, label: 'News', target_type: 'category', target_id: 3, sort_order: 3, open_in_new_tab: 1 })
    ]

    const targets = {
      post: new Map(),
      page: new Map([[10, 'about-us'], [11, 'team']]),
      category: new Map([[3, 'news']])
    }

    const tree = buildPublicTree(items, targets)

    assert.deepStrictEqual(tree.map(node => [node.label, node.url]), [
      ['Home', '/'], ['About', '/about-us'], ['News', '/category/news']
    ])
    assert.deepStrictEqual(tree[1].children.map(node => node.url), ['/team'])
    assert.deepStrictEqual(tree[1].target, { id: 10, slug: 'about-us' })
    assert.strictEqual(tree[2].new_tab, true)
  })

  test('items are validated: no script URLs, and a target replaces any URL', () => {
    assert.ok('errors' in validateMenuItem({ label: 'x', url: 'javascript:alert(1)' }))
    assert.ok('errors' in validateMenuItem({ label: '', url: '/a' }))
    assert.ok('errors' in validateMenuItem({ label: 'x', target_type: 'user', target_id: 1 }))

    const linked = validateMenuItem({ label: 'About', url: '/ignored', target_type: 'page', target_id: '4' })
    assert.strictEqual(linked.values.url, null)
    assert.strictEqual(linked.values.target_id, 4)
  })

  test('reorders must cover the whole menu and nest one level', () => {
    assert.ok('order' in validateReorder([{ id: 1 }, { id: 2, parent_id: 1 }, { id: 3 }], [1, 2, 3]))
    assert.ok('error' in validateReorder([{ id: 1 }, { id: 2 }], [1, 2, 3]), 'partial list')
    assert.ok('error' in validateReorder([{ id: 1 }, { id: 2, parent_id: 1 }, { id: 3, parent_id: 2 }], [1, 2, 3]), 'two levels')
    assert.ok('error' in validateReorder([{ id: 1, parent_id: 1 }], [1]), 'own parent')
    assert.ok('error' in validateReorder([{ id: 1 }, { id: 1 }], [1]), 'duplicate')
  })

  test('the migration creates the built-in locations', async () => {
    const db = memoryDb()
    await menusMigration.up(db, grammar)
    const rows = await db.all('SELECT location FROM menus ORDER BY id')
    assert.deepStrictEqual(rows.map(r => r.location), ['primary', 'secondary', 'footer'])
  })

  test('public navigation uses the live-post rule and is cacheable', () => {
    assert.match(read('src/models/Menu.ts'), /livePost\('posts'\)/)
    assert.match(read('src/routes/api/v1.ts'), /'\/api\/v1\/navigation', publicApiLimit, content, cacheable,/)
    for (const line of read('src/routes/api/navigation.ts').split('\n').filter(l => /router\./.test(l))) {
      assert.match(line, /auth, requireCapability\('settings\.manage'\)/, line)
    }
  })
})

describe('redirects', () => {
  let db

  beforeEach(async () => {
    db = memoryDb()
    await redirectsMigration.up(db, grammar)
  })

  const map = async () =>
    Object.fromEntries((await db.all('SELECT from_path, to_path FROM redirects ORDER BY from_path')).map(r => [r.from_path, r.to_path]))

  test('a slug change records a 301', async () => {
    await Redirect.recordSlugChange('post', '/blog/a', '/blog/b', db)
    const row = await db.get('SELECT * FROM redirects')
    assert.strictEqual(row.from_path, '/blog/a')
    assert.strictEqual(row.to_path, '/blog/b')
    assert.strictEqual(row.status, 301)
    assert.strictEqual(row.source, 'post')
  })

  test('chains collapse: A→B then B→C leaves A→C and B→C', async () => {
    await Redirect.recordSlugChange('post', '/blog/a', '/blog/b', db)
    await Redirect.recordSlugChange('post', '/blog/b', '/blog/c', db)
    assert.deepStrictEqual(await map(), { '/blog/a': '/blog/c', '/blog/b': '/blog/c' })
  })

  test('taking a slug back removes the redirect away from it, and makes no loop', async () => {
    await Redirect.recordSlugChange('post', '/blog/a', '/blog/b', db)
    await Redirect.recordSlugChange('post', '/blog/b', '/blog/a', db)
    assert.deepStrictEqual(await map(), { '/blog/b': '/blog/a' })

    await Redirect.recordSlugChange('post', '/blog/a', '/blog/c', db)
    assert.deepStrictEqual(await map(), { '/blog/a': '/blog/c', '/blog/b': '/blog/c' })
  })

  test('a new page at a redirected path releases it', async () => {
    await Redirect.recordSlugChange('page', '/about', '/about-us', db)
    await Redirect.releasePath('/about', db)
    assert.deepStrictEqual(await map(), {})
  })

  test('manual redirects that would loop are refused', async () => {
    await Redirect.save({ from_path: '/a', to_path: '/b', status: 301 }, 'manual', db)
    await Redirect.save({ from_path: '/b', to_path: '/c', status: 301 }, 'manual', db)

    // Saving /b re-pointed /a at /c, so nothing is two hops.
    assert.deepStrictEqual(await map(), { '/a': '/c', '/b': '/c' })

    assert.strictEqual(await Redirect.wouldLoop('/c', '/a', undefined, db), true)
    assert.strictEqual(await Redirect.wouldLoop('/d', '/a', undefined, db), false)
    assert.strictEqual(await Redirect.wouldLoop('/c', 'https://elsewhere.example/a', undefined, db), false)

    // Editing a row: its own current rule does not count, the rest do.
    await Redirect.save({ from_path: '/x', to_path: '/y', status: 301 }, 'manual', db)
    await db.run("INSERT INTO redirects (from_path, to_path) VALUES ('/y', '/z')")
    const y = await Redirect.findByPath('/y', db)
    assert.strictEqual(await Redirect.wouldLoop('/y', '/x', y.id, db), true)
    const x = await Redirect.findByPath('/x', db)
    assert.strictEqual(await Redirect.wouldLoop('/x', '/q', x.id, db), false)
  })

  test('validation refuses self-redirects, bad statuses and script targets', () => {
    assert.ok('errors' in validateRedirect({ from_path: '/a/', to_path: '/a', status: 301 }))
    assert.ok('errors' in validateRedirect({ from_path: '/a', to_path: '/b', status: 307 }))
    assert.ok('errors' in validateRedirect({ from_path: '/a', to_path: 'javascript:alert(1)' }))
    assert.deepStrictEqual(validateRedirect({ from_path: 'old/', to_path: '/new' }).values, { from_path: '/old', to_path: '/new', status: 301 })
  })

  test('public reads resolve chains to one hop, and drop loops', async () => {
    const rows = resolveChains([
      { from_path: '/a', to_path: '/b' },
      { from_path: '/b', to_path: '/c' },
      { from_path: '/x', to_path: '/y' },
      { from_path: '/y', to_path: '/x' }
    ])
    assert.deepStrictEqual(rows, [{ from_path: '/a', to_path: '/c' }, { from_path: '/b', to_path: '/c' }])

    await Redirect.save({ from_path: '/old', to_path: '/mid', status: 302 }, 'manual', db)
    await db.run("INSERT INTO redirects (from_path, to_path) VALUES ('/mid', '/new')")
    const found = await Redirect.lookup('/old', db)
    assert.strictEqual(found.to_path, '/new')
    assert.strictEqual(found.status, 302)
    assert.strictEqual(await Redirect.lookup('/nothing', db), undefined)
  })

  test('the post and page update paths record slug changes; admin routes need settings.manage', () => {
    const post = read('src/controllers/PostController.ts')
    assert.match(post, /const updated = await Post\.update\([\s\S]{0,200}redirectIfSlugChanged\('post', post, updated\)/)

    const page = read('src/controllers/PageController.ts')
    assert.match(page, /const updated = await Page\.update\([\s\S]{0,200}redirectIfSlugChanged\('page', page, updated\)/)

    for (const line of read('src/routes/api/redirects.ts').split('\n').filter(l => /router\./.test(l))) {
      assert.match(line, /auth, requireCapability\('settings\.manage'\)/, line)
    }

    assert.match(read('src/routes/api/v1.ts'), /'\/api\/v1\/redirects', publicApiLimit, content, cacheable,/)
    assert.match(read('src/routes/api/v1.ts'), /'\/api\/v1\/site', publicApiLimit, content, cacheable,/)
  })

  test('only published content earns a redirect, and a failure never fails the save', () => {
    const helper = read('src/helpers/redirects.ts')
    assert.match(helper, /if \(!before\.published \|\| before\.deleted_at\) return/)
    assert.match(helper, /try \{\s*await Redirect\.recordSlugChange[\s\S]*?catch/)
  })
})
