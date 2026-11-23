/**
 * Import and export: the parsers, the mappings, and a round trip through real
 * (in-memory SQLite) databases migrated with this repository's migrations.
 *
 * The parsing and mapping functions are pure and tested against small
 * fixtures under tests/fixtures/. The writers are tested end to end, because
 * their rules — skip what exists, never promote an author, never export a
 * password — only mean anything against a schema.
 */

import { test, describe, before } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseXml, decodeXmlEntities, childText } from '../scripts/lib/xml.mjs'
import { htmlToMarkdown, autop, expandShortcodes, commentText } from '../scripts/lib/html-to-markdown.mjs'
import { parseWxr, attachmentDimensions } from '../scripts/lib/wxr.mjs'
import { parseGhost, markdownCard } from '../scripts/lib/ghost.mjs'
import { mapRestSite } from '../scripts/lib/wordpress-rest.mjs'
import { importSite } from '../scripts/lib/site-import.mjs'
import { readExport, importExport } from '../scripts/lib/json-import.mjs'
import { toTimestamp, unusablePassword, withDryRun, parseArgs } from '../scripts/lib/import-common.mjs'
import { exportToString, isSecretSetting, EXPORT_FORMAT, EXPORT_VERSION } from '../src/helpers/export-data.ts'
import { verifyPassword } from '@basicbenframework/core/auth'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CORE = join(ROOT, 'node_modules/@basicbenframework/core/src/db')
const fixture = (name) => readFileSync(join(ROOT, 'tests/fixtures', name), 'utf-8')

/** A fresh database at the current schema, with one admin. */
async function freshDb() {
  const { createSqliteAdapter } = await import(join(CORE, 'adapters/sqlite.js'))
  const { createMigrator } = await import(join(CORE, 'migrator.js'))
  const db = await createSqliteAdapter(':memory:', { wal: false })
  await (await createMigrator(join(ROOT, 'db/migrations'), db)).migrate()
  await db.run(
    "INSERT INTO users (name, email, password, role, slug) VALUES ('Admin', 'admin@example.com', 'x:y:1:1:1:1', 'admin', 'admin')"
  )
  const admin = await db.get("SELECT id FROM users WHERE email = 'admin@example.com'")
  return { db, adminId: admin.id }
}

describe('the XML parser', () => {
  test('reads elements, attributes, CDATA and prefixed names', () => {
    const doc = parseXml('<?xml version="1.0"?><a x="1 &amp; 2"><wp:b><![CDATA[<p>raw</p>]]></wp:b><c/></a>')
    const a = doc.children[0]
    assert.strictEqual(a.attrs.x, '1 & 2')
    assert.strictEqual(childText(a, 'wp:b'), '<p>raw</p>')
    assert.strictEqual(a.children[1].name, 'c')
  })

  test('decodes only the predefined and numeric entities', () => {
    assert.strictEqual(decodeXmlEntities('&lt;&#65;&#x42;&quot;&nbsp;'), '<AB"&nbsp;')
  })

  test('refuses a DTD internal subset, so entity expansion cannot happen', () => {
    const bomb = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">]><a>&lol;</a>'
    assert.throws(() => parseXml(bomb), /DTD/)
  })

  test('reports mismatched tags with a line number', () => {
    assert.throws(() => parseXml('<a>\n<b></a>'), /line 2/)
  })
})

describe('HTML to Markdown', () => {
  test('converts the common blog vocabulary', () => {
    const md = htmlToMarkdown(
      '<h2>Title &amp; more</h2><p>Some <strong>bold</strong> and <em>it</em> with <a href="https://x.test/">a link</a>.</p>' +
        '<ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul><blockquote><p>quote</p></blockquote>'
    )
    assert.match(md, /^## Title & more/)
    assert.match(md, /Some \*\*bold\*\* and \*it\* with \[a link\]\(https:\/\/x\.test\/\)\./)
    assert.match(md, /- one\n- two\n {2}- nested/)
    assert.match(md, /> quote/)
  })

  test('fences code with its language and keeps indentation', () => {
    const md = htmlToMarkdown('<pre><code class="language-js">if (a) {\n  b()\n}</code></pre>')
    assert.strictEqual(md, '```js\nif (a) {\n  b()\n}\n```')
  })

  test('tables become GFM tables, figures keep their captions', () => {
    const md = htmlToMarkdown(
      '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>' +
        '<figure><img src="/p.png" alt="P"><figcaption>Cap</figcaption></figure>'
    )
    assert.match(md, /\| a \| b \|\n\| --- \| --- \|\n\| 1 \| 2 \|/)
    assert.match(md, /!\[P\]\(\/p\.png\)\n\n\*Cap\*/)
  })

  test('drops scripts and unsafe links, and turns embeds into links', () => {
    const md = htmlToMarkdown('<p><a href="javascript:alert(1)">x</a></p><script>alert(1)</script><iframe src="https://video.test/e/1"></iframe>')
    assert.doesNotMatch(md, /javascript|alert/)
    assert.match(md, /\[Embedded content\]\(https:\/\/video\.test\/e\/1\)/)
  })

  test('escapes text that would otherwise become Markdown', () => {
    assert.strictEqual(htmlToMarkdown('<p>1. not *a* list</p>'), '1\\. not \\*a\\* list')
  })

  test('autop makes paragraphs of classic-editor text and leaves blocks alone', () => {
    assert.strictEqual(autop('one\ntwo\n\nthree'), '<p>one<br />\ntwo</p>\n<p>three</p>')
    const blocks = '<!-- wp:paragraph -->\n<p>x</p>\n<!-- /wp:paragraph -->'
    assert.strictEqual(autop(blocks), blocks)
  })

  test('[caption] becomes a figure with its caption', () => {
    const html = expandShortcodes('[caption id="a"]<img src="a.jpg" alt=""> Hi[/caption]')
    assert.strictEqual(html, '<figure><img src="a.jpg" alt=""><figcaption>Hi</figcaption></figure>')
  })

  test('comments become plain text, not Markdown', () => {
    assert.strictEqual(commentText('<p>Lovely *soup* &amp; bread</p><p>Two</p>'), 'Lovely *soup* & bread\n\nTwo')
  })
})

describe('the WXR mapping', () => {
  const site = parseWxr(fixture('wordpress-export.xml'))
  const post = (slug) => site.posts.find((p) => p.slug === slug)

  test('reads authors, categories with hierarchy, and tags', () => {
    assert.deepStrictEqual(site.authors.map((a) => [a.key, a.email, a.name]), [['jane', 'jane@example.com', 'Jane Doe']])
    const recipes = site.categories.find((c) => c.slug === 'recipes')
    assert.strictEqual(recipes.parentKey, 'food')
    assert.strictEqual(site.categories.find((c) => c.slug === 'food').name, 'Food & Drink')
    assert.deepStrictEqual(site.tags.map((t) => t.slug), ['quick'])
  })

  test('maps statuses: future is scheduled, private is a draft, trash is dropped', () => {
    assert.strictEqual(post('soup-and-bread').status, 'published')
    assert.strictEqual(post('coming-soon').status, 'published')
    assert.strictEqual(post('coming-soon').publishAt, '2099-01-01 00:00:00')
    assert.strictEqual(post('secret-diary').status, 'draft')
    assert.strictEqual(post('secret-diary').createdAt, '2024-03-01 08:00:00')
    assert.strictEqual(post('soup-revision'), undefined)
    assert.ok(site.notes.some((n) => /private/.test(n)))
  })

  test('keeps page hierarchy, order and template', () => {
    const team = post('team')
    assert.strictEqual(team.type, 'page')
    assert.strictEqual(team.parentKey, '30')
    assert.strictEqual(team.menuOrder, 2)
    assert.strictEqual(team.template, 'full-width')
  })

  test('links the featured image to its attachment and reads its dimensions', () => {
    assert.strictEqual(post('soup-and-bread').featuredImage, 'attachment:10')
    const media = site.media[0]
    assert.deepStrictEqual([media.width, media.height, media.size, media.alt], [1600, 900, 123456, 'A bowl of soup'])
    assert.deepStrictEqual(attachmentDimensions('s:5:"width";i:10;'), { width: 10, height: null, filesize: null })
  })

  test('threads comments, marks spam, drops pingbacks', () => {
    assert.strictEqual(site.comments.length, 3)
    const reply = site.comments.find((c) => c.key === '20:101')
    assert.strictEqual(reply.parentKey, '20:100')
    assert.strictEqual(reply.userKey, 'jane')
    assert.strictEqual(site.comments.find((c) => c.key === '20:102').status, 'spam')
  })

  test('uses Yoast fields but not unresolved templates', () => {
    assert.strictEqual(post('soup-and-bread').seo.meta_description, 'The best soup.')
    assert.strictEqual(post('soup-and-bread').seo.meta_title, null)
  })
})

describe('the Ghost mapping', () => {
  const site = parseGhost(fixture('ghost-export.json'), { siteUrl: 'https://ghost.example.com/' })
  const post = (slug) => site.posts.find((p) => p.slug === slug)

  test('resolves __GHOST_URL__ and reads posts_meta', () => {
    const hello = post('hello-ghost')
    assert.strictEqual(hello.featuredImage, 'https://ghost.example.com/content/images/2024/03/cover.jpg')
    assert.match(hello.html, /href="https:\/\/ghost\.example\.com\/about\/"/)
    assert.strictEqual(hello.seo.og_title, 'Hello on social')
    assert.strictEqual(hello.seo.og_image, 'https://ghost.example.com/content/images/2024/03/og.jpg')
    assert.strictEqual(hello.seo.canonical_url, 'https://elsewhere.example.com/hello')
    assert.strictEqual(hello.excerpt, 'A first post.')
  })

  test('tags in sort order, internal tags dropped, primary tag also a category', () => {
    const hello = post('hello-ghost')
    assert.deepStrictEqual(hello.tagKeys, ['t1', 't2'])
    assert.deepStrictEqual(site.categories.map((c) => c.slug), ['news'])
    assert.ok(!site.tags.some((t) => t.slug === 'hash-hidden'))
    const off = parseGhost(fixture('ghost-export.json'), { primaryTagAsCategory: false })
    assert.strictEqual(off.categories.length, 0)
  })

  test('statuses: sent newsletters are drafts, pages are pages', () => {
    assert.strictEqual(post('newsletter-1').status, 'draft')
    assert.strictEqual(post('about').type, 'page')
    assert.ok(site.notes.some((n) => /members-only or paid/.test(n)))
  })

  test('falls back to a Mobiledoc Markdown card when there is no html', () => {
    assert.strictEqual(post('members-only').markdown, '# Secret\n\nFor *members*.')
    assert.strictEqual(markdownCard('not json'), null)
  })

  test('without a site URL, placeholder images are dropped with a note', () => {
    const bare = parseGhost(fixture('ghost-export.json'))
    assert.strictEqual(bare.posts[0].featuredImage, null)
    assert.ok(bare.notes.some((n) => /__GHOST_URL__/.test(n)))
  })
})

describe('the WordPress REST mapping', () => {
  test('maps posts, pages, comments and authors', () => {
    const site = mapRestSite({
      posts: [{
        id: 1, slug: 'hi', status: 'publish', date_gmt: '2024-01-01T00:00:00', author: 7, featured_media: 9,
        title: { rendered: 'Hi &amp; bye' }, content: { rendered: '<p>Body</p>' }, excerpt: { rendered: '<p>Sum [&hellip;]</p>' },
        _embedded: { 'wp:term': [[{ taxonomy: 'category', slug: 'news', name: 'News' }], [{ taxonomy: 'post_tag', slug: 't', name: 'T' }]] }
      }],
      pages: [{ id: 2, slug: 'child', status: 'publish', parent: 3, menu_order: 4, title: { rendered: 'Child' }, content: { rendered: '' } }],
      media: [{ id: 9, source_url: 'https://cdn.test/a.jpg', media_details: { width: 10, height: 20 } }],
      comments: [
        { id: 5, post: 1, parent: 0, author: 0, author_name: 'R', status: 'approved', content: { rendered: '<p>Nice</p>' } },
        { id: 6, post: 1, parent: 0, type: 'pingback', content: { rendered: 'x' } }
      ],
      users: [{ id: 7, name: 'Jo', slug: 'jo' }],
      categories: []
    })

    const [post, page] = site.posts
    assert.strictEqual(post.title, 'Hi & bye')
    assert.strictEqual(post.excerpt, 'Sum ...')
    assert.strictEqual(post.featuredImage, 'attachment:9')
    assert.deepStrictEqual([post.categoryKeys, post.tagKeys, post.authorKey], [['news'], ['t'], '7'])
    assert.deepStrictEqual([page.type, page.parentKey, page.menuOrder], ['page', 'page:3', 4])
    assert.strictEqual(site.comments.length, 1)
    assert.strictEqual(site.comments[0].postKey, 'post:1')
    assert.strictEqual(site.authors[0].email, null)
  })
})

describe('small helpers', () => {
  test('timestamps are stored as ISO UTC, WordPress zeroes are null', () => {
    assert.strictEqual(toTimestamp('2024-02-01 09:00:00'), '2024-02-01T09:00:00.000Z')
    assert.strictEqual(toTimestamp('0000-00-00 00:00:00'), null)
    assert.strictEqual(toTimestamp('nonsense'), null)
  })

  test('the imported-author password matches nothing', async () => {
    const hash = unusablePassword()
    assert.strictEqual(await verifyPassword('', hash), false)
    assert.strictEqual(await verifyPassword(hash, hash), false)
  })

  test('argument parsing rejects unknown flags', () => {
    assert.deepStrictEqual(parseArgs(['f.xml', '--dry-run'], { flags: ['dry-run'] }).positional, ['f.xml'])
    assert.throws(() => parseArgs(['--nope'], { flags: [] }), /Unknown option/)
  })

  test('credential-looking settings are recognised', () => {
    assert.ok(isSecretSetting('smtp_password'))
    assert.ok(isSecretSetting('stripe_api_key'))
    assert.ok(!isSecretSetting('site_name'))
  })
})

describe('importing into a database', () => {
  let db, adminId

  before(async () => {
    ({ db, adminId } = await freshDb())
  })

  test('a dry run writes nothing but reports what a real run would', async () => {
    const site = parseWxr(fixture('wordpress-export.xml'))
    const report = await withDryRun(db, true, (tx) => importSite(tx, site, { defaultAuthorId: adminId }))
    assert.strictEqual(report.get('posts', 'created'), 3)
    const { n } = await db.get('SELECT COUNT(*) AS n FROM posts')
    assert.strictEqual(n, 0)
  })

  test('WXR import creates everything, wired together', async () => {
    const site = parseWxr(fixture('wordpress-export.xml'))
    const report = await importSite(db, site, { defaultAuthorId: adminId })

    assert.strictEqual(report.get('posts', 'created'), 3)
    assert.strictEqual(report.get('pages', 'created'), 2)
    assert.strictEqual(report.get('comments', 'created'), 2)
    // The comments table has a status column (migration 030), so WordPress
    // spam arrives marked as spam rather than being dropped.
    assert.strictEqual(report.get('comments', 'created as spam'), 1)
    assert.strictEqual((await db.get("SELECT COUNT(*) AS n FROM comments WHERE status = 'spam' AND approved = 0")).n, 1)

    const jane = await db.get("SELECT * FROM users WHERE email = 'jane@example.com'")
    assert.strictEqual(jane.role, 'author')
    assert.strictEqual(await verifyPassword('', jane.password), false)

    const soup = await db.get("SELECT * FROM posts WHERE slug = 'soup-and-bread'")
    assert.strictEqual(soup.user_id, jane.id)
    assert.strictEqual(soup.status, 'published')
    assert.strictEqual(soup.publish_at, '2024-02-01T09:00:00.000Z')
    assert.match(soup.content, /First paragraph with \*\*bold\*\*\.\\\nSecond line of it\./)
    assert.match(soup.content, /\*Steaming\*/)
    assert.match(soup.content_html, /<strong>bold<\/strong>/)
    assert.strictEqual(soup.excerpt, 'A warm soup.')

    const media = await db.get('SELECT * FROM media WHERE id = ?', [soup.featured_image])
    assert.deepStrictEqual([media.path, media.width, media.height, media.mime_type], ['2024/01/header.jpg', 1600, 900, 'image/jpeg'])

    const cats = await db.all('SELECT c.slug FROM post_categories pc JOIN categories c ON c.id = pc.category_id WHERE pc.post_id = ? ORDER BY c.slug', [soup.id])
    assert.deepStrictEqual(cats.map((c) => c.slug), ['food', 'recipes'])
    const recipes = await db.get("SELECT parent_id FROM categories WHERE slug = 'recipes'")
    const food = await db.get("SELECT id FROM categories WHERE slug = 'food'")
    assert.strictEqual(recipes.parent_id, food.id)

    const scheduled = await db.get("SELECT live_notified, publish_at FROM posts WHERE slug = 'coming-soon'")
    assert.deepStrictEqual([scheduled.live_notified, scheduled.publish_at], [0, '2099-01-01T00:00:00.000Z'])

    const about = await db.get("SELECT id FROM pages WHERE slug = 'about'")
    const team = await db.get("SELECT parent_id, menu_order, template FROM pages WHERE slug = 'team'")
    assert.deepStrictEqual([team.parent_id, team.menu_order, team.template], [about.id, 2, 'full-width'])

    const comments = await db.all('SELECT * FROM comments ORDER BY id')
    assert.strictEqual(comments[1].parent_id, comments[0].id)
    assert.strictEqual(comments[1].user_id, jane.id)
    assert.strictEqual(comments[0].content, 'Lovely *soup* & bread!')
  })

  test('a second run is a no-op; --update overwrites without duplicating', async () => {
    const site = parseWxr(fixture('wordpress-export.xml'))
    await db.run("UPDATE posts SET title = 'Edited here' WHERE slug = 'soup-and-bread'")

    const again = await importSite(db, site, { defaultAuthorId: adminId })
    assert.strictEqual(again.get('posts', 'created'), 0)
    assert.strictEqual(again.get('posts', 'existing'), 3)
    assert.strictEqual(again.get('comments', 'created'), 0)
    assert.strictEqual((await db.get("SELECT title FROM posts WHERE slug = 'soup-and-bread'")).title, 'Edited here')

    const updated = await importSite(db, site, { defaultAuthorId: adminId, update: true })
    assert.strictEqual(updated.get('posts', 'updated'), 3)
    assert.strictEqual((await db.get("SELECT title FROM posts WHERE slug = 'soup-and-bread'")).title, 'Soup & Bread')
    assert.strictEqual((await db.get('SELECT COUNT(*) AS n FROM post_categories')).n, 2)
  })

  test('an existing account is matched and never promoted or changed', async () => {
    const site = parseGhost(fixture('ghost-export.json'), { siteUrl: 'https://ghost.example.com' })
    await db.run("INSERT INTO users (name, email, password, role, slug) VALUES ('Writer', 'writer@example.com', 'keep', 'editor', 'writer')")

    const report = await importSite(db, site, { defaultAuthorId: adminId })
    assert.strictEqual(report.get('authors', 'matched'), 1)
    const writer = await db.get("SELECT * FROM users WHERE email = 'writer@example.com'")
    assert.deepStrictEqual([writer.role, writer.password, writer.name], ['editor', 'keep', 'Writer'])

    const hello = await db.get("SELECT * FROM posts WHERE slug = 'hello-ghost'")
    assert.strictEqual(hello.user_id, writer.id)
    assert.strictEqual(hello.og_title, 'Hello on social')
    assert.ok(hello.og_image)
    assert.strictEqual(hello.canonical_url, 'https://elsewhere.example.com/hello')
    const news = await db.get("SELECT id FROM categories WHERE slug = 'news'")
    assert.strictEqual(hello.category_id, news.id)

    // "about" already existed from the WXR import, so Ghost's page is skipped.
    assert.strictEqual(report.get('pages', 'existing'), 1)
    const members = await db.get("SELECT content, status FROM posts WHERE slug = 'members-only'")
    assert.deepStrictEqual([members.status, members.content], ['draft', '# Secret\n\nFor *members*.'])
  })
})

describe('export and JSON import', () => {
  let source, sourceAdmin, exported

  before(async () => {
    ({ db: source, adminId: sourceAdmin } = await freshDb())
    await importSite(source, parseWxr(fixture('wordpress-export.xml')), { defaultAuthorId: sourceAdmin })
    await source.run("INSERT INTO settings (key, value) VALUES ('smtp_password', 'hunter2')")
    await source.run("INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at) VALUES (?, 'reset', 'secret-hash', '2099-01-01')", [sourceAdmin])
    await source.run("INSERT INTO api_tokens (user_id, name, token_hash, scopes, created_at) VALUES (?, 't', 'api-hash', '[]', '2024-01-01')", [sourceAdmin])
    await source.run("INSERT INTO user_two_factor (user_id, totp_secret) VALUES (?, 'totp-secret')", [sourceAdmin])
    await source.run("INSERT INTO post_revisions (post_id, title, content) SELECT id, 'old', 'old body' FROM posts WHERE slug = 'soup-and-bread'")
    exported = await exportToString(source, { pageSize: 2 })
  })

  test('is one valid, versioned JSON document', () => {
    const doc = JSON.parse(exported)
    assert.strictEqual(doc.format, EXPORT_FORMAT)
    assert.strictEqual(doc.version, EXPORT_VERSION)
    assert.strictEqual(doc.tables.posts.length, 3)
    assert.strictEqual(doc.counts.posts, 3)
    // Paging at two rows still yields every row exactly once.
    assert.deepStrictEqual(doc.tables.pages.map((p) => p.slug).sort(), ['about', 'team'])
  })

  test('carries no secrets', () => {
    for (const secret of ['hunter2', 'secret-hash', 'api-hash', 'totp-secret', 'x:y:1:1:1:1', '!imported:']) {
      assert.ok(!exported.includes(secret), `export contains ${secret}`)
    }
    const doc = JSON.parse(exported)
    assert.ok(!('password' in doc.tables.users[0]))
    assert.deepStrictEqual(doc.omitted.columns.users, ['password', 'token_version'])
    assert.deepStrictEqual(doc.omitted.settings, ['smtp_password'])
    const omitted = doc.omitted.tables.map((t) => t.name)
    for (const table of ['auth_tokens', 'api_tokens', 'user_two_factor', 'user_credentials', 'rate_limits', 'post_revisions']) {
      assert.ok(omitted.includes(table), `${table} should be reported as omitted`)
    }
  })

  test('revisions are included only when asked for', async () => {
    const doc = JSON.parse(await exportToString(source, { revisions: true }))
    assert.strictEqual(doc.tables.post_revisions.length, 1)
  })

  test('refuses other formats and newer versions', () => {
    assert.throws(() => readExport('{"format":"other"}'), /Not a basicben-export/)
    assert.throws(() => readExport(JSON.stringify({ format: EXPORT_FORMAT, version: EXPORT_VERSION + 1, tables: {} })), /newer/)
    assert.throws(() => readExport('{"format": "basicben-export", "tab'), /not valid JSON/)
  })

  test('round-trips into a database that already has content, remapping ids', async () => {
    const { db: target, adminId: targetAdmin } = await freshDb()
    // Pre-existing rows shift every id, so a copied id would point at the wrong row.
    await target.run("INSERT INTO categories (name, slug) VALUES ('Existing', 'existing')")
    await target.run("INSERT INTO media (filename, original_name, path) VALUES ('z', 'z', 'z/z.png')")
    await target.run("INSERT INTO posts (user_id, title, slug, content) VALUES (?, 'Mine', 'mine', 'x')", [targetAdmin])

    const doc = readExport(JSON.parse(await exportToString(source, { revisions: true })))
    const report = await importExport(target, doc, { defaultAuthorId: targetAdmin })

    assert.strictEqual(report.get('posts', 'created'), 3)
    assert.strictEqual(report.get('users', 'matched'), 1) // the admin, by address
    assert.strictEqual(report.get('users', 'created'), 1)

    const soup = await target.get("SELECT * FROM posts WHERE slug = 'soup-and-bread'")
    const jane = await target.get("SELECT * FROM users WHERE email = 'jane@example.com'")
    assert.strictEqual(soup.user_id, jane.id)
    assert.strictEqual(jane.role, 'author')
    assert.strictEqual(await verifyPassword('', jane.password), false)
    assert.strictEqual((await target.get('SELECT path FROM media WHERE id = ?', [soup.featured_image])).path, '2024/01/header.jpg')

    const cats = await target.all('SELECT c.slug FROM post_categories pc JOIN categories c ON c.id = pc.category_id WHERE pc.post_id = ? ORDER BY c.slug', [soup.id])
    assert.deepStrictEqual(cats.map((c) => c.slug), ['food', 'recipes'])

    const comments = await target.all("SELECT * FROM comments WHERE status <> 'spam' ORDER BY id")
    assert.strictEqual(comments.length, 2)
    assert.strictEqual((await target.get("SELECT COUNT(*) AS n FROM comments WHERE status = 'spam'")).n, 1)
    assert.strictEqual(comments[1].parent_id, comments[0].id)
    assert.strictEqual(comments[0].post_id, soup.id)

    const about = await target.get("SELECT id FROM pages WHERE slug = 'about'")
    assert.strictEqual((await target.get("SELECT parent_id FROM pages WHERE slug = 'team'")).parent_id, about.id)
    assert.strictEqual((await target.get('SELECT COUNT(*) AS n FROM post_revisions')).n, 1)

    // Idempotent.
    const again = await importExport(target, doc, { defaultAuthorId: targetAdmin })
    assert.strictEqual(again.get('posts', 'created'), 0)
    assert.strictEqual(again.get('comments', 'created'), 0)
    assert.strictEqual((await target.get('SELECT COUNT(*) AS n FROM posts')).n, 4)
  })

  test('tables the target lacks are skipped with a note, not fatal', async () => {
    const { db: target, adminId } = await freshDb()
    const doc = readExport(exported)
    // Every phase 2 table exists at the current schema, so use one that
    // never will: a newer CMS's table this database has not migrated to.
    doc.tables.widgets = [{ id: 1, name: 'sidebar' }]
    const report = await importExport(target, doc, { defaultAuthorId: adminId })
    assert.ok(report.notes.some((n) => /widgets/.test(n)))
  })
})

describe('the admin export endpoint', () => {
  const read = (path) => readFileSync(join(ROOT, path), 'utf-8')

  test('is admin-only and refuses API tokens', () => {
    const routes = read('src/routes/api/export.ts')
    assert.match(routes, /router\.get\('\/api\/export', auth, requireSession, requireRole\(ROLES\.ADMIN\)/)
  })

  test('streams the shared export and is never cached', () => {
    const controller = read('src/controllers/ExportController.ts')
    assert.match(controller, /exportChunks\(db/)
    assert.match(controller, /Cache-Control', 'no-store'/)
  })
})

describe('phase 2 tables survive a move between databases', () => {
  test('menu links follow their target, snippets keep their author, IPs stay home', async () => {
    const { db: source, adminId } = await freshDb()
    await source.run("INSERT INTO posts (user_id, title, slug, content, published, status) VALUES (?, 'A', 'a', 'x', 1, 'published'), (?, 'B', 'b', 'x', 1, 'published')", [adminId, adminId])
    const b = await source.get("SELECT id FROM posts WHERE slug = 'b'")
    const primary = await source.get("SELECT id FROM menus WHERE location = 'primary'")
    await source.run("INSERT INTO menu_items (menu_id, label, target_type, target_id, sort_order) VALUES (?, 'B', 'post', ?, 0)", [primary.id, b.id])
    await source.run("INSERT INTO redirects (from_path, to_path, status, source) VALUES ('/old', '/blog/b', 301, 'manual')")
    await source.run("INSERT INTO snippets (name, content, created_by) VALUES ('Sig', 'bye', ?)", [adminId])
    const a = await source.get("SELECT id FROM posts WHERE slug = 'a'")
    await source.run("INSERT INTO comments (post_id, author_name, author_email, content, status, approved, author_ip) VALUES (?, 'G', 'g@example.com', 'hello there', 'approved', 1, '203.0.113.9')", [a.id])

    const text = await exportToString(source, {})
    assert.ok(!text.includes('203.0.113.9'), 'the export carries a commenter IP')
    assert.ok(!JSON.parse(text).tables.post_locks, 'edit locks are per-database state')

    // The target already has posts, so the ids cannot line up by accident.
    const { db: target, adminId: targetAdmin } = await freshDb()
    for (const slug of ['x1', 'x2', 'x3']) {
      await target.run("INSERT INTO posts (user_id, title, slug, content, published, status) VALUES (?, ?, ?, 'x', 1, 'published')", [targetAdmin, slug, slug])
    }
    await importExport(target, readExport(JSON.parse(text)), { defaultAuthorId: targetAdmin })

    const item = await target.get("SELECT target_type, target_id FROM menu_items WHERE label = 'B'")
    const linked = await target.get('SELECT slug FROM posts WHERE id = ?', [item.target_id])
    assert.strictEqual(linked.slug, 'b', 'the menu item points at a different post after import')
    assert.ok(await target.get("SELECT 1 FROM redirects WHERE from_path = '/old' AND to_path = '/blog/b'"))
    const snippet = await target.get("SELECT created_by FROM snippets WHERE name = 'Sig'")
    assert.strictEqual(snippet.created_by, targetAdmin, 'snippet authorship was not remapped')

    const again = await importExport(target, readExport(JSON.parse(text)), { defaultAuthorId: targetAdmin })
    assert.strictEqual(again.get('menu_items', 'created') ?? 0, 0)
    assert.strictEqual((await target.get('SELECT COUNT(*) AS n FROM snippets')).n, 1)
  })
})
