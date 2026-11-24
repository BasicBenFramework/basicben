/**
 * The theme feature: the server-rendered reference site and the oEmbed
 * provider. Templates and oEmbed responses are pure and tested directly; an
 * entry is rendered from a real post read through PublicContent.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert'
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const FEATURE = 'src/features/theme'
const read = (path) => readFileSync(join(ROOT, path), 'utf-8')
const load = (path) => import(pathToFileURL(join(ROOT, path)).href)

const scratch = mkdtempSync(join(tmpdir(), 'basicben-theme-'))
process.env.DATABASE_URL = join(scratch, 'test.sqlite')
process.env.APP_KEY = 'theme-test-key-that-is-long-enough-to-sign-with'
process.env.SITE_URL = 'https://site.example'

let db, PublicContent

before(async () => {
  const { createMigrator } = await load('node_modules/@basicbenframework/core/src/db/migrator.js')
  await (await createMigrator()).migrate()
  db = await (await import('@basicbenframework/core/db')).getDb()
  const user = await db.run("INSERT INTO users (name, email, password, role, email_verified) VALUES ('Ada', 'ada@example.test', 'x', 'admin', 1)")
  const now = new Date(Date.now() - 1000).toISOString()
  await db.run(
    `INSERT INTO posts (title, slug, content, content_html, user_id, published, status, publish_at, created_at, updated_at)
     VALUES ('Old live post', 'old-live', 'Old live post body', '<p>Old live post body</p>', ?, 1, 'published', ?, ?, ?)`,
    [Number(user.lastInsertRowid), now, now, now]
  )
  ;({ PublicContent } = await load('src/models/PublicContent.ts'))
})

after(() => rmSync(scratch, { recursive: true, force: true }))

describe('the reference theme templates', () => {
  let html, templates
  let site
  const types = [
    { key: 'post', builtin: true, route_base: '/blog', singular_label: 'Post', plural_label: 'Posts', fields: [] },
    { key: 'recipe', builtin: false, route_base: '/recipes', singular_label: 'Recipe', plural_label: 'Recipes', fields: [] }
  ]
  const ctx = () => ({ site, path: '/', types, menu: [] })

  before(async () => {
    html = await load(`${FEATURE}/html.ts`)
    templates = await load(`${FEATURE}/templates.ts`)
    // The real site info, as the theme controller loads it, with a name that
    // needs escaping and some code injection.
    const { Settings } = await load('src/models/Settings.ts')
    site = { ...(await Settings.siteInfo()), name: 'My <Site>', code_injection: { head: '<meta name="x-injected">', foot: '' } }
  })

  test('interpolations are escaped unless marked safe', () => {
    assert.strictEqual(html.html`<p>${'<b>&"'}</p>`.value, '<p>&lt;b&gt;&amp;&quot;</p>')
    assert.strictEqual(html.html`<p>${html.raw('<b>ok</b>')}</p>`.value, '<p><b>ok</b></p>')
    assert.strictEqual(html.html`${[1, null, false, html.html`<i>x</i>`]}`.value, '1<i>x</i>')
  })

  test('JSON-LD cannot close its script block', () => {
    const out = html.jsonForScript({ name: '</script><script>alert(1)</script>' }).value
    assert.ok(!out.includes('</script>'))
    assert.deepStrictEqual(JSON.parse(out), { name: '</script><script>alert(1)</script>' })
  })

  test('unsafe hrefs become #', () => {
    assert.strictEqual(html.safeHref('javascript:alert(1)'), '#')
    assert.strictEqual(html.safeHref('//evil.test'), '#')
    assert.strictEqual(html.safeHref('/blog/x'), '/blog/x')
    assert.strictEqual(html.safeHref('https://a.test'), 'https://a.test')
  })

  test('entry paths use the type route base', () => {
    assert.strictEqual(templates.pathOf(ctx(), { slug: 'x', id: 1, type: 'recipe' }), '/recipes/x')
    assert.strictEqual(templates.pathOf(ctx(), { slug: 'x', id: 1, type: 'post' }), '/blog/x')
  })

  test('the home page pages as /page/n, the route it has; an archive adds ?page=n', () => {
    assert.strictEqual(templates.listingPath('/', 1), '/')
    assert.strictEqual(templates.listingPath('/', 2), '/page/2')
    assert.strictEqual(templates.listingPath('/category/news', 1), '/category/news')
    assert.strictEqual(templates.listingPath('/category/news', 3), '/category/news?page=3')
  })

  test("the home page's pager, canonical and prev/next all use /page/n", () => {
    const listing = (page) => templates.renderListing(ctx(), { title: 'Home', basePath: '/', heading: false, posts: [], page, totalPages: 3 })
    const second = listing(2)
    assert.ok(!second.includes('?page='), 'no ?page= link is left on the home page')
    assert.match(second, /<a rel="prev" href="\/">/)
    assert.match(second, /<a rel="next" href="\/page\/3">/)
    assert.match(second, /<link rel="canonical" href="[^"]*\/page\/2">/)
    assert.match(listing(1), /<a rel="next" href="\/page\/2">/)
  })

  test('the head carries canonical, feeds, oEmbed discovery and JSON-LD; the title is escaped', () => {
    const page = templates.documentHtml(ctx(), {
      title: 'A <title>',
      description: 'Desc',
      canonical: 'https://site.example/blog/a',
      embeddable: 'https://site.example/blog/a',
      jsonLd: { '@type': 'BlogPosting', headline: 'A' },
      type: 'article'
    }, html.html`<main>hi</main>`)

    assert.match(page, /^<!doctype html>/i)
    assert.match(page, /<title>A &lt;title&gt;/)
    assert.match(page, /<link rel="canonical" href="https:\/\/site\.example\/blog\/a">/)
    assert.match(page, /type="application\/rss\+xml"/)
    assert.match(page, /type="application\/json\+oembed" href="\/oembed\?url=https%3A%2F%2Fsite\.example%2Fblog%2Fa&amp;format=json"|type="application\/json\+oembed"[^>]*oembed\?url=/)
    assert.match(page, /<script type="application\/ld\+json">/)
    assert.match(page, /property="og:title"/)
    assert.ok(page.includes('<meta name="x-injected">'), 'code injection is the admin\'s, on purpose')
    assert.ok(page.includes('My &lt;Site&gt;'))
  })

  test('a real entry renders with its body and escaped title', async () => {
    const post = await PublicContent.post('old-live')
    const page = templates.renderEntry({ ...ctx(), path: '/blog/old-live' }, { ...post, title: '<script>x</script>' })
    assert.ok(page.includes('<p>Old live post body</p>'))
    assert.ok(!page.includes('<script>x</script>'))
  })

  test('a members-only entry renders a notice, not an empty article', async () => {
    const post = await PublicContent.post('old-live')
    const page = templates.renderEntry({ ...ctx(), path: '/blog/old-live' }, { ...post, content: null, fields: null, gated: true, excerpt: 'A <teaser>' })
    assert.ok(page.includes('This post is for members.'))
    assert.ok(page.includes('A &lt;teaser&gt;'))
    assert.ok(!page.includes('Old live post body'))
  })
})

describe('oEmbed', () => {
  let oembed, parseTarget

  before(async () => {
    oembed = await load(`${FEATURE}/oembed.ts`)
    ;({ parseTarget } = await load(`${FEATURE}/OEmbedController.ts`))
  })

  test('fit keeps the ratio and never scales up', () => {
    assert.deepStrictEqual(oembed.fit(1200, 600, 600, null), { width: 600, height: 300 })
    assert.deepStrictEqual(oembed.fit(1200, 600, 1000, 100), { width: 200, height: 100 })
    assert.deepStrictEqual(oembed.fit(300, 200, 1000, 1000), { width: 300, height: 200 })
  })

  test('a rich response respects maxwidth and escapes the card', () => {
    const body = oembed.resolveOEmbed({
      kind: 'rich', title: '<img onerror=x>', description: null, authorName: 'Ada', authorUrl: '/author/ada',
      thumbnail: { url: 'https://site.example/i.jpg', width: 1600, height: 900 },
      url: 'https://site.example/blog/a', providerName: 'Site', providerUrl: 'https://site.example', maxWidth: 400, maxHeight: null
    })
    assert.strictEqual(body.version, '1.0')
    assert.strictEqual(body.type, 'rich')
    assert.ok(body.width <= 400)
    assert.ok(body.thumbnail_width <= 400)
    assert.ok(!body.html.includes('<img'))
    assert.strictEqual(body.author_url, 'https://site.example/author/ada')
  })

  test('a thumbnail of unknown size is left out when a maximum is asked for', () => {
    const body = oembed.resolveOEmbed({
      kind: 'link', title: 'About', description: null, authorName: null, authorUrl: null,
      thumbnail: { url: 'https://site.example/i.jpg', width: null, height: null },
      url: 'https://site.example/about', providerName: 'Site', providerUrl: 'https://site.example', maxWidth: 300, maxHeight: null
    })
    assert.strictEqual(body.thumbnail_url, undefined)
    assert.strictEqual(body.html, undefined)
  })

  test('only URLs on this site are answered', () => {
    assert.deepStrictEqual(parseTarget('https://site.example/blog/a/?x=1', 'https://site.example').segments, ['blog', 'a'])
    assert.strictEqual(parseTarget('https://site.example.evil.test/blog/a', 'https://site.example'), null)
    assert.strictEqual(parseTarget('not a url', 'https://site.example'), null)
    assert.strictEqual(parseTarget('https://site.example/blog/a', ''), null)
  })
})

describe('wiring', () => {
  test('the theme routes are gated by DISABLE_PUBLIC_SITE and never shadow the API, admin, feeds or assets', () => {
    const routes = read(`${FEATURE}/routes.ts`)
    assert.match(routes, /DISABLE_PUBLIC_SITE/)
    assert.match(routes, /\/oembed/)

    const controller = read(`${FEATURE}/ThemeController.ts`)
    assert.match(controller, /DISABLE_PUBLIC_SITE/)
    for (const segment of ['admin', 'feed', 'login']) assert.ok(controller.includes(`'${segment}'`), segment)
    assert.match(controller, /\/api\//)

    const reserved = read('src/helpers/content-paths.ts')
    for (const segment of ['api', 'admin', 'feed', 'oembed', 'assets']) assert.ok(reserved.includes(`'${segment}'`), segment)
  })

  test('the theme reads content only through PublicContent', () => {
    const controller = read(`${FEATURE}/ThemeController.ts`)
    assert.match(controller, /PublicContent\./)
    assert.ok(!/FROM posts/i.test(controller), 'no direct post queries')
  })

  test('public_theme is a setting the feature defines', () => {
    assert.match(read(`${FEATURE}/index.ts`), /public_theme:\s*\{ group: 'reading'/)
    assert.doesNotMatch(read('src/helpers/site-settings.ts'), /public_theme:/)
  })

  test('the theme must be listed last, so its catch-all routes are mounted last', async () => {
    const { enabledFeatureNames } = await import('../../host/enabled.ts')
    assert.deepStrictEqual(enabledFeatureNames(['members', 'theme']), ['members', 'theme'])
    assert.throws(() => enabledFeatureNames(['theme', 'members']), /"theme" must be listed after "members"/)
  })
})
