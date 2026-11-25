/**
 * The SEO fixes from the 2026-11-25 review:
 *
 * - the sitemap lists only canonical URLs, and only categories with something
 *   live in them, each with a lastmod;
 * - robots.txt keeps out /admin without catching pages that merely start with
 *   "admin", and a custom file still points at the sitemap;
 * - an editor's SEO title is the whole <title>; pages and archives do not all
 *   borrow the site description; empty archives, and tag and author archives
 *   when Settings → Reading says so, are noindex;
 * - members-only posts say so in their structured data;
 * - the admin's shell, served by the theme, is noindex.
 *
 * Real modules over a scratch database, as private-content.test.js does.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const load = (path) => import(pathToFileURL(join(ROOT, path)).href)

const scratch = mkdtempSync(join(tmpdir(), 'basicben-seo-'))
process.env.DATABASE_URL = join(scratch, 'test.sqlite')
process.env.APP_KEY = 'seo-test-key-that-is-long-enough-to-sign-with'
process.env.SITE_URL = 'https://site.example'
process.env.PUBLIC_THEME = 'ssr'

let db, FeedController, ThemeController, PublicContent, Settings, templates
const ids = {}

function response() {
  return {
    status: 200,
    statusCode: 200,
    headers: {},
    json(data, status = 200) { this.body = data; this.status = status },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    redirect(to, status = 302) { this.redirected = to; this.status = status },
    end(text) { this.text = text; this.status = this.statusCode },
    send(text) { this.text = text }
  }
}

const get = (path, params = {}) => ({ method: 'GET', path, params, query: {}, headers: { host: 'site.example' } })

async function addPost(slug, extra = {}) {
  const now = new Date(Date.now() - 60_000).toISOString()
  const columns = { title: slug, slug, content: `${slug} body`, content_html: `<p>${slug} body</p>`, excerpt: `${slug} excerpt`,
    user_id: ids.user, published: 1, status: 'published', publish_at: now, created_at: now, updated_at: '2026-03-04 05:06:07', ...extra }
  const keys = Object.keys(columns)
  const result = await db.run(`INSERT INTO posts (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, Object.values(columns))
  return Number(result.lastInsertRowid)
}

before(async () => {
  const { createMigrator } = await load('node_modules/@basicbenframework/core/src/db/migrator.js')
  await (await createMigrator()).migrate()
  db = await (await import('@basicbenframework/core/db')).getDb()

  ;({ FeedController } = await load('src/controllers/FeedController.ts'))
  ;({ ThemeController } = await load('src/features/theme/ThemeController.ts'))
  ;({ PublicContent } = await load('src/models/PublicContent.ts'))
  ;({ Settings } = await load('src/models/Settings.ts'))
  templates = await load('src/features/theme/templates.ts')

  const user = await db.run("INSERT INTO users (name, email, password, role, email_verified, slug) VALUES ('Ada', 'ada@example.test', 'x', 'admin', 1, 'ada')")
  ids.user = Number(user.lastInsertRowid)

  ids.own = await addPost('own-post')
  ids.syndicated = await addPost('syndicated', { canonical_url: 'https://elsewhere.example/original' })
  ids.selfCanonical = await addPost('self-canonical', { canonical_url: 'https://site.example/blog/self-canonical' })
  ids.members = await addPost('members-only', { visibility: 'members' })

  const full = await db.run("INSERT INTO categories (name, slug) VALUES ('Full', 'full')")
  await db.run("INSERT INTO categories (name, slug) VALUES ('Empty', 'empty')")
  await db.run('INSERT INTO post_categories (post_id, category_id) VALUES (?, ?)', [ids.own, Number(full.lastInsertRowid)])

  const tag = await db.run("INSERT INTO tags (name, slug) VALUES ('Things', 'things')")
  await db.run('INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)', [ids.own, Number(tag.lastInsertRowid)])

  await db.run(
    "INSERT INTO pages (title, slug, content, content_html, published) VALUES ('About', 'about', ?, ?, 1)",
    ['## Hello\n\nWe make **small** tools for people who write. ' + 'More words here. '.repeat(20), '<h2>Hello</h2><p>We make <strong>small</strong> tools</p>']
  )
  await Settings.set('site_description', 'The site-wide description')
})

after(() => rmSync(scratch, { recursive: true, force: true }))

describe('sitemap', () => {
  let xml
  before(async () => {
    const res = response()
    await FeedController.sitemap(get('/sitemap.xml'), res)
    xml = res.text
  })

  test('lists posts whose canonical URL is their own, and not ones first published elsewhere', () => {
    assert.match(xml, /\/blog\/own-post</)
    assert.match(xml, /\/blog\/self-canonical</)
    assert.doesNotMatch(xml, /syndicated/)
  })

  test('lists only categories with live posts, with a lastmod', () => {
    assert.match(xml, /<loc>https:\/\/site\.example\/category\/full<\/loc>\s*<lastmod>2026-03-04T05:06:07\.000Z<\/lastmod>/)
    assert.doesNotMatch(xml, /category\/empty/)
  })

  test('reads bare SQLite timestamps as UTC', () => {
    assert.match(xml, /<loc>https:\/\/site\.example\/blog\/own-post<\/loc>\s*<lastmod>2026-03-04T05:06:07\.000Z/)
  })
})

describe('robots.txt', () => {
  test('the default blocks /admin exactly and as a folder, not as a prefix', async () => {
    const res = response()
    await FeedController.robots(get('/robots.txt'), res)
    assert.match(res.text, /^Disallow: \/admin\$$/m)
    assert.match(res.text, /^Disallow: \/admin\/$/m)
    assert.doesNotMatch(res.text, /^Disallow: \/admin$/m)
    assert.match(res.text, /^Sitemap: https:\/\/site\.example\/sitemap\.xml$/m)
  })

  test('a custom file without a Sitemap line gets one; one with its own is left alone', async () => {
    await Settings.set('robots_txt', 'User-agent: *\nDisallow: /private/')
    let res = response()
    await FeedController.robots(get('/robots.txt'), res)
    assert.match(res.text, /^Disallow: \/private\/$/m)
    assert.match(res.text, /^Sitemap: https:\/\/site\.example\/sitemap\.xml$/m)

    await Settings.set('robots_txt', 'User-agent: *\nsitemap: https://cdn.example/map.xml')
    res = response()
    await FeedController.robots(get('/robots.txt'), res)
    assert.strictEqual((res.text.match(/sitemap:/gi) ?? []).length, 1)

    await Settings.set('robots_txt', '')
  })
})

describe('theme head tags', () => {
  const site = () => ({ name: 'Site', description: 'The site-wide description', url: 'https://site.example', locale: 'en', timezone: 'UTC',
    logo_url: null, icon_url: null, default_social_image_url: null, code_injection: { head: '', foot: '' } })
  const ctx = (path = '/') => ({ site: site(), path, types: [{ key: 'post', builtin: true, route_base: '/blog' }], menu: [] })
  const title = (html) => html.match(/<title>([^<]*)<\/title>/)[1]
  const description = (html) => html.match(/<meta name="description" content="([^"]*)">/)?.[1] ?? null

  test("an editor's SEO title is the whole title; without one the site name is added", async () => {
    const [post] = (await PublicContent.posts({ limit: 50 })).posts.filter((p) => p.slug === 'own-post')
    assert.strictEqual(title(templates.renderEntry(ctx(), post)), 'own-post — Site')
    assert.strictEqual(title(templates.renderEntry(ctx(), { ...post, meta_title: 'Hand-written title' })), 'Hand-written title')
  })

  test('a page without a meta description uses the start of its body, not the site description', async () => {
    const page = await PublicContent.page('about')
    const html = templates.renderPage(ctx('/about'), page)
    const text = description(html)
    assert.ok(text, 'has a description')
    assert.doesNotMatch(text, /site-wide/)
    assert.doesNotMatch(text, /[#*<]/)
    assert.ok(text.length <= 161, `at most about 160 characters, got ${text.length}`)
    assert.match(page.og.description ?? '', /small tools/, 'the content API share card falls back to the body too')
  })

  test('an archive without an intro has no description; the home page keeps the site one', () => {
    const view = { title: 'Tagged “x”', basePath: '/tag/x', posts: [{ id: 1, slug: 'a', title: 'A', excerpt: null, published_at: null, type: 'post' }], page: 1, totalPages: 1 }
    assert.strictEqual(description(templates.renderListing(ctx('/tag/x'), view)), null)
    assert.strictEqual(description(templates.renderListing(ctx('/'), { ...view, basePath: '/', heading: false })), 'The site-wide description')
  })

  test('an empty archive is noindex, the home page never is', () => {
    const empty = { title: 'Empty', basePath: '/category/empty', posts: [], page: 1, totalPages: 1 }
    assert.match(templates.renderListing(ctx('/category/empty'), empty), /<meta name="robots" content="noindex">/)
    assert.doesNotMatch(templates.renderListing(ctx('/'), { ...empty, basePath: '/', heading: false }), /name="robots"/)
  })

  test('tag and author archives follow Settings → Reading', async () => {
    const render = async (handler, path, slug) => {
      const res = response()
      await ThemeController[handler](get(path, { slug }), res)
      return res.text
    }
    assert.doesNotMatch(await render('tag', '/tag/things', 'things'), /name="robots"/)
    assert.doesNotMatch(await render('author', '/author/ada', 'ada'), /name="robots"/)

    await Settings.set('noindex_tag_archives', 'true')
    await Settings.set('noindex_author_archives', 'true')
    assert.match(await render('tag', '/tag/things', 'things'), /<meta name="robots" content="noindex">/)
    assert.match(await render('author', '/author/ada', 'ada'), /<meta name="robots" content="noindex">/)
  })
})

describe('structured data', () => {
  test('a members-only post is marked as not free to read; a public one is not', async () => {
    const posts = (await PublicContent.posts({ limit: 50 })).posts
    const members = posts.find((p) => p.slug === 'members-only')
    const open = posts.find((p) => p.slug === 'own-post')
    assert.strictEqual(members.structured_data.isAccessibleForFree, false)
    assert.ok(!('isAccessibleForFree' in open.structured_data))
  })
})

describe('the admin shell', () => {
  test('is noindex when the theme serves it, except the public SPA pages', async () => {
    const dir = join(scratch, 'public')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>')
    const cwd = process.cwd()
    process.chdir(scratch)
    try {
      const shell = async (path, slug) => {
        const res = response()
        await ThemeController.single({ ...get(path, { slug }) }, res)
        return res
      }
      const login = await shell('/login', 'login')
      assert.strictEqual(login.headers['x-robots-tag'], 'noindex')
      const docs = await shell('/docs', 'docs')
      assert.strictEqual(docs.headers['x-robots-tag'], undefined)
    } finally {
      process.chdir(cwd)
    }
  })
})
