/**
 * Three editor items from the 2026-11-23 review:
 *
 * - private posts and pages, WordPress-style: published, but for the people
 *   who can edit them, in the admin, and for nobody on any public surface;
 * - autosave for a post that has never been saved;
 * - the social-card image pickers, and resolving a pasted URL to the library
 *   item it serves.
 *
 * Real modules over a scratch database, as access.test.js does.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const load = (path) => import(pathToFileURL(join(ROOT, path)).href)
const read = (path) => readFileSync(join(ROOT, path), 'utf-8')

const scratch = mkdtempSync(join(tmpdir(), 'basicben-private-'))
process.env.DATABASE_URL = join(scratch, 'test.sqlite')
process.env.APP_KEY = 'private-test-key-that-is-long-enough-to-sign-with'
process.env.SITE_URL = 'https://site.example'
process.env.PUBLIC_THEME = 'ssr'

let db, PublicContent, PostController, PageController, FeedController, MediaController, OEmbedController, ThemeController, Post, Page
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

const person = (id, role) => ({ id, role, email_verified: true })
const as = (id, role, body = {}, params = {}) => ({ method: 'POST', body, params, query: {}, headers: {}, userId: id, user: person(id, role) })

async function addUser(name, role) {
  const result = await db.run(
    'INSERT INTO users (name, email, password, role, email_verified, slug) VALUES (?, ?, ?, ?, 1, ?)',
    [name, `${name.toLowerCase()}@example.test`, 'x', role, name.toLowerCase()]
  )
  return Number(result.lastInsertRowid)
}

before(async () => {
  const { createMigrator } = await load('node_modules/@basicbenframework/core/src/db/migrator.js')
  await (await createMigrator()).migrate()
  db = await (await import('@basicbenframework/core/db')).getDb()

  ;({ PublicContent } = await load('src/models/PublicContent.ts'))
  ;({ PostController } = await load('src/controllers/PostController.ts'))
  ;({ PageController } = await load('src/controllers/PageController.ts'))
  ;({ FeedController } = await load('src/controllers/FeedController.ts'))
  ;({ MediaController } = await load('src/controllers/MediaController.ts'))
  ;({ OEmbedController } = await load('src/features/theme/OEmbedController.ts'))
  ;({ ThemeController } = await load('src/features/theme/ThemeController.ts'))
  ;({ Post } = await load('src/models/Post.ts'))
  ;({ Page } = await load('src/models/Page.ts'))

  ids.editor = await addUser('Edna', 'editor')
  ids.author = await addUser('Arthur', 'author')
  ids.other = await addUser('Olive', 'author')

  const category = await db.run("INSERT INTO categories (name, slug) VALUES ('Secrets', 'secrets')")
  ids.category = Number(category.lastInsertRowid)
})

after(() => rmSync(scratch, { recursive: true, force: true }))

describe('private posts', () => {
  before(async () => {
    // Written through the admin API, as an author would: their own post, made
    // private, then published by an editor.
    const created = response()
    await PostController.store(as(ids.author, 'author', {
      title: 'Hidden musings', content: 'PRIVATE BODY that nobody else reads.', slug: 'hidden-musings',
      category_ids: [ids.category], is_private: true
    }), created)
    assert.strictEqual(created.status, 201, JSON.stringify(created.body))
    ids.private = created.body.post.id

    const published = response()
    await PostController.update(as(ids.editor, 'editor', {
      title: 'Hidden musings', content: 'PRIVATE BODY that nobody else reads.', status: 'published'
    }, { id: String(ids.private) }), published)
    assert.strictEqual(published.status, 200, JSON.stringify(published.body))

    const open = response()
    await PostController.store(as(ids.editor, 'editor', {
      title: 'Open letter', content: 'PUBLIC BODY for everyone.', slug: 'open-letter', status: 'published'
    }), open)
    ids.public = open.body.post.id
  })

  test('the flag is stored, and the post is otherwise published', async () => {
    const row = await db.get('SELECT is_private, published, status FROM posts WHERE id = ?', [ids.private])
    assert.deepStrictEqual({ ...row, is_private: Number(row.is_private), published: Number(row.published) }, { is_private: 1, published: 1, status: 'published' })
  })

  test('the content API leaves it out: listings, the single item, search, counts', async () => {
    const { posts, total } = await PublicContent.posts({ perPage: 50 })
    assert.deepStrictEqual(posts.map((p) => p.id), [ids.public])
    assert.strictEqual(total, 1)

    assert.strictEqual(await PublicContent.post('hidden-musings'), null)
    assert.strictEqual(await PublicContent.post(String(ids.private)), null, 'not by id either')

    const searched = await PublicContent.posts({ search: 'musings' })
    assert.strictEqual(searched.posts.length, 0)

    const category = (await PublicContent.categories()).find((c) => c.id === ids.category)
    assert.strictEqual(Number(category?.post_count ?? category?.count ?? 0), 0, 'a private post is not counted')

    const authors = await PublicContent.authors()
    assert.ok(!authors.some((a) => a.id === ids.author), 'an author with only private posts is not listed')

    assert.doesNotMatch(JSON.stringify(posts), /PRIVATE BODY/)
  })

  test('the RSS and JSON feeds and the sitemap leave it out', async () => {
    const rss = response()
    await FeedController.rss({ headers: { host: 'site.example' }, query: {} }, rss)
    assert.match(rss.text, /Open letter/)
    assert.doesNotMatch(rss.text, /Hidden musings|PRIVATE BODY/)

    const json = response()
    await FeedController.json({ headers: { host: 'site.example' }, query: {} }, json)
    const feed = json.text ?? JSON.stringify(json.body)
    assert.match(feed, /Open letter/)
    assert.doesNotMatch(feed, /Hidden musings|PRIVATE BODY/)

    const sitemap = response()
    await FeedController.sitemap({ headers: { host: 'site.example' }, query: {} }, sitemap)
    assert.match(sitemap.text, /open-letter/)
    assert.doesNotMatch(sitemap.text, /hidden-musings/)
  })

  test('the theme and oEmbed answer 404', async () => {
    const page = response()
    await ThemeController.post({ path: '/blog/hidden-musings', params: { slug: 'hidden-musings' }, query: {}, headers: { host: 'site.example' } }, page)
    assert.strictEqual(page.status, 404)
    assert.doesNotMatch(page.text ?? '', /PRIVATE BODY/)

    const live = response()
    await ThemeController.post({ path: '/blog/open-letter', params: { slug: 'open-letter' }, query: {}, headers: { host: 'site.example' } }, live)
    assert.strictEqual(live.status, 200)

    const embed = response()
    await OEmbedController.show({ query: { url: 'https://site.example/blog/hidden-musings' }, headers: { host: 'site.example' } }, embed)
    assert.strictEqual(embed.status, 404)
  })

  test('the built-in blog and comments treat it as not there', async () => {
    assert.strictEqual(await Post.findPublishedById(ids.private), undefined)
    const feed = response()
    await PostController.feedShow({ params: { id: String(ids.private) }, headers: {} }, feed)
    assert.strictEqual(feed.status, 404)
  })

  test('in the admin: its author, editors and admins see it; other authors do not', async () => {
    for (const [id, role] of [[ids.author, 'author'], [ids.editor, 'editor']]) {
      const res = response()
      await PostController.show(as(id, role, {}, { id: String(ids.private) }), res)
      assert.strictEqual(res.status, 200, role)
      assert.strictEqual(Number(res.body.post.is_private), 1)
    }

    const stranger = response()
    await PostController.show(as(ids.other, 'author', {}, { id: String(ids.private) }), stranger)
    assert.strictEqual(stranger.status, 404)

    const list = response()
    await PostController.index({ ...as(ids.editor, 'editor'), query: {} }, list)
    assert.ok(list.body.posts.some((p) => p.id === ids.private && Number(p.is_private) === 1), 'listed, with the flag for the badge')
  })

  test('making it public again puts it back, without republishing', async () => {
    const before = await db.get('SELECT publish_at FROM posts WHERE id = ?', [ids.private])
    const res = response()
    await PostController.update(as(ids.editor, 'editor', {
      title: 'Hidden musings', content: 'PRIVATE BODY that nobody else reads.', is_private: false
    }, { id: String(ids.private) }), res)
    assert.strictEqual(res.status, 200)
    assert.ok(await PublicContent.post('hidden-musings'))
    const after = await db.get('SELECT publish_at FROM posts WHERE id = ?', [ids.private])
    assert.strictEqual(after.publish_at, before.publish_at)

    // And private again for the rest of the file.
    await Post.update(ids.private, { is_private: 1 })
    assert.strictEqual(await PublicContent.post('hidden-musings'), null)
  })
})

describe('private pages', () => {
  before(async () => {
    for (const [slug, isPrivate] of [['team-handbook', true], ['about', false]]) {
      const res = response()
      await PageController.store(as(ids.editor, 'editor', { title: slug, slug, content: `${slug} body`, published: true, is_private: isPrivate }), res)
      assert.strictEqual(res.status, 201, JSON.stringify(res.body))
      ids[slug] = res.body.page.id
    }
  })

  test('the content API, the theme and the sitemap leave it out', async () => {
    assert.strictEqual(await PublicContent.page('team-handbook'), null)
    assert.ok(await PublicContent.page('about'))
    const { pages, total } = await PublicContent.pages({ perPage: 50 })
    assert.deepStrictEqual(pages.map((p) => p.slug), ['about'])
    assert.strictEqual(total, 1)

    const theme = response()
    await ThemeController.single({ path: '/team-handbook', params: { slug: 'team-handbook' }, query: {}, headers: { host: 'site.example' } }, theme)
    assert.strictEqual(theme.status, 404)

    const sitemap = response()
    await FeedController.sitemap({ headers: { host: 'site.example' }, query: {} }, sitemap)
    assert.doesNotMatch(sitemap.text, /team-handbook/)
    assert.strictEqual(await Page.findPublishedBySlug('team-handbook'), undefined)
  })

  test('the admin still has it, flagged', async () => {
    const res = response()
    await PageController.show({ params: { id: String(ids['team-handbook']) } }, res)
    assert.strictEqual(Number(res.body.page.is_private), 1)
  })

  test('an update that does not mention it leaves it alone', async () => {
    const res = response()
    await PageController.update(as(ids.editor, 'editor', { title: 'Team handbook' }, { id: String(ids['team-handbook']) }), res)
    assert.strictEqual(Number(res.body.page.is_private), 1)
  })
})

describe('the rule lives in one place', () => {
  test('livePost and livePage both exclude private', async () => {
    const { livePost, livePage } = await load('src/models/visibility.ts')
    assert.match(livePost('p'), /p\.is_private = 0/)
    assert.match(livePage('pages'), /pages\.published = 1 AND pages\.is_private = 0/)
  })

  test('no public page query filters on the flag by hand', () => {
    for (const file of ['src/models/PublicContent.ts', 'src/controllers/FeedController.ts', 'src/models/Menu.ts', 'src/models/Page.ts']) {
      assert.doesNotMatch(read(file), /\bpublished = 1\b/, `${file} filters pages without livePage`)
    }
  })

  test('the migration is JavaScript and adds the column to both tables', () => {
    const migration = read('db/migrations/043_add_private_content.js')
    assert.match(migration, /ALTER TABLE posts ADD COLUMN is_private/)
    assert.match(migration, /ALTER TABLE pages ADD COLUMN is_private/)
  })
})

describe('autosaving a post that has never been saved', () => {
  test('the first title is enough to make a draft, which then autosaves like any post', async () => {
    const res = response()
    await PostController.autosaveNew(as(ids.author, 'author', { title: 'Hey', content: '', excerpt: '' }), res)
    assert.strictEqual(res.status, 201, JSON.stringify(res.body))
    const row = await db.get('SELECT title, slug, status, published, user_id FROM posts WHERE id = ?', [res.body.post.id])
    assert.deepStrictEqual({ ...row, published: Number(row.published) }, { title: 'Hey', slug: null, status: 'draft', published: 0, user_id: ids.author })

    const saved = response()
    await PostController.autosave(as(ids.author, 'author', { title: 'Hi there', content: 'More words now', excerpt: '' }, { id: String(res.body.post.id) }), saved)
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.body))
    assert.ok(saved.body.autosave.id)

    // The first real save, with the slug box blank as the editor leaves it,
    // derives the address from the title it has by then — not from "Hey".
    const real = response()
    await PostController.update(as(ids.author, 'author', { title: 'Hi there, readers', content: 'More words now', slug: '' }, { id: String(res.body.post.id) }), real)
    assert.strictEqual(real.status, 200, JSON.stringify(real.body))
    assert.strictEqual(real.body.post.slug, 'hi-there-readers')
  })

  test('two untitled drafts can both exist: no provisional slug to collide on', async () => {
    for (let i = 0; i < 2; i++) {
      const res = response()
      await PostController.autosaveNew(as(ids.author, 'author', { title: '', content: `Body only ${i}` }), res)
      assert.strictEqual(res.status, 201, JSON.stringify(res.body))
      assert.strictEqual(res.body.post.slug, null)
    }
  })

  test('nothing typed, or a stray keystroke, creates nothing', async () => {
    const before = await db.get('SELECT COUNT(*) AS n FROM posts')
    for (const body of [{ title: '  ', content: '' }, { title: 'a', content: '' }, { title: 'Hi', content: 'short' }]) {
      const res = response()
      await PostController.autosaveNew(as(ids.author, 'author', body), res)
      assert.strictEqual(res.status, 422, JSON.stringify(body))
    }
    const after = await db.get('SELECT COUNT(*) AS n FROM posts')
    assert.strictEqual(Number(after.n), Number(before.n))
  })

  test('it never publishes or makes anything private, whatever is sent', async () => {
    const res = response()
    await PostController.autosaveNew(as(ids.editor, 'editor', {
      title: 'Sneaky', content: 'Body text', status: 'published', published: true, is_private: true, user_id: ids.other
    }), res)
    assert.strictEqual(res.status, 201)
    const row = await db.get('SELECT status, published, is_private, user_id FROM posts WHERE id = ?', [res.body.post.id])
    assert.deepStrictEqual(
      { status: row.status, published: Number(row.published), is_private: Number(row.is_private), user_id: row.user_id },
      { status: 'draft', published: 0, is_private: 0, user_id: ids.editor }
    )
  })

  test('a repeat with the same key gets the same draft, not a second one', async () => {
    const key = 'editor-screen-key-1'
    const first = response()
    await PostController.autosaveNew(as(ids.author, 'author', { title: 'Keyed draft', content: '', autosave_key: key }), first)
    assert.strictEqual(first.status, 201)

    // The response to that was lost; the editor tries again with newer text.
    const again = response()
    await PostController.autosaveNew(as(ids.author, 'author', { title: 'Keyed draft, more', content: 'and a body now', autosave_key: key }), again)
    assert.strictEqual(again.status, 200)
    assert.strictEqual(again.body.post.id, first.body.post.id)
    const rows = await db.get('SELECT COUNT(*) AS n FROM posts WHERE autosave_key = ?', [key])
    assert.strictEqual(Number(rows.n), 1)

    // The key is the author's: someone else's same key is a draft of their own.
    const other = response()
    await PostController.autosaveNew(as(ids.other, 'author', { title: 'Same key, other author', content: '', autosave_key: key }), other)
    assert.strictEqual(other.status, 201)
    assert.notStrictEqual(other.body.post.id, first.body.post.id)

    const bad = response()
    await PostController.autosaveNew(as(ids.author, 'author', { title: 'Bad key here', content: '', autosave_key: 'x' }), bad)
    assert.strictEqual(bad.status, 422)
  })

  test('the route needs a person who may create posts', () => {
    assert.match(read('src/routes/api/posts.ts'), /router\.post\('\/api\/posts\/autosave', auth, requireCapability\('post\.create'\), PostController\.autosaveNew\)/)
  })

  test('the editor creates the draft once, on the first title or body, and keeps the screen', () => {
    const editor = read('src/client/pages/admin/PostEditor.tsx')
    assert.match(editor, /api\s*\.post<[^>]+>\('\/api\/posts\/autosave'/)
    assert.match(editor, /const hasText = worthAutosaving\(formData\.title, formData\.content\)/)
    assert.match(editor, /autosave_key: autosaveKey\.current/)
    assert.match(editor, /if \(isPage \|\| postId \|\| !hasText\) return/)
    // Replaced in place, and not reloaded over the typing.
    assert.match(editor, /navigate\(to, \{ replace: true \}\)/)
    assert.match(editor, /if \(postId && postId === adopted\.current\) return/)
    // A Save while it is in flight updates that post rather than making a second.
    assert.match(editor, /await creatingDraft\.current/)
  })
})

describe('social card images', () => {
  before(async () => {
    const media = await db.run(
      "INSERT INTO media (filename, original_name, path, mime_type, size, user_id) VALUES ('uploads/card.png', 'card.png', 'uploads/card.png', 'image/png', 10, ?)",
      [ids.editor]
    )
    ids.media = Number(media.lastInsertRowid)
  })

  test('a pasted URL finds the library item it serves, from any host or prefix', async () => {
    for (const url of ['https://cdn.example/uploads/card.png', '/storage/uploads/card.png', 'uploads/card.png']) {
      const res = response()
      await MediaController.index({ query: { url }, headers: {} }, res)
      assert.deepStrictEqual(res.body.media.map((m) => m.id), [ids.media], url)
    }

    const miss = response()
    await MediaController.index({ query: { url: 'https://elsewhere.example/other.png' }, headers: {} }, miss)
    assert.strictEqual(miss.body.media.length, 0)
  })

  test('a key with _ or % in it is matched exactly, not as a pattern', async () => {
    const row = await db.run(
      "INSERT INTO media (filename, original_name, path, mime_type, size, user_id) VALUES ('uploads/a_b%.png', 'a_b%.png', 'uploads/a_b%.png', 'image/png', 10, ?)",
      [ids.editor]
    )
    const hit = response()
    await MediaController.index({ query: { url: 'https://cdn.example/uploads/a_b%25.png' }, headers: {} }, hit)
    assert.deepStrictEqual(hit.body.media.map((m) => m.id), [Number(row.lastInsertRowid)])

    for (const url of ['https://cdn.example/uploads/aXbY.png', 'https://cdn.example/uploads/a_bcd.png']) {
      const miss = response()
      await MediaController.index({ query: { url }, headers: {} }, miss)
      assert.strictEqual(miss.body.media.length, 0, url)
    }
  })

  test('the chosen ids are saved, and become the cards', async () => {
    const res = response()
    await PostController.update(as(ids.editor, 'editor', {
      title: 'Open letter', content: 'PUBLIC BODY for everyone.', og_image: ids.media, twitter_image: String(ids.media)
    }, { id: String(ids.public) }), res)
    assert.strictEqual(res.status, 200)
    const post = await PublicContent.post('open-letter')
    assert.match(post.og.image_url, /uploads\/card\.png$/)
    assert.match(post.twitter.image_url, /uploads\/card\.png$/)
  })

  test('both editors show a picker for each image', () => {
    const editor = read('src/client/pages/admin/PostEditor.tsx')
    assert.match(editor, /<SocialImageField\s+id="og_image"/)
    assert.match(editor, /<SocialImageField\s+id="twitter_image"/)
    assert.match(read('src/client/components/admin/SocialImageField.tsx'), /<MediaPicker /)
  })
})

describe('nothing else names a private item', () => {
  let redirects

  before(async () => {
    redirects = await load('src/helpers/redirects.ts')
  })

  const rows = async () => (await db.all('SELECT from_path, to_path FROM redirects')).map((r) => `${r.from_path} -> ${r.to_path}`)

  test('renaming a private post or page records no public redirect', async () => {
    const before = await rows()
    await redirects.redirectIfSlugChanged('post', { id: 1, slug: 'q3-layoffs', published: 1, is_private: 1 }, { id: 1, slug: 'q3-plan', published: 1, is_private: 1 })
    await redirects.redirectIfSlugChanged('page', { id: 2, slug: 'secret-page', published: 1, is_private: 1 }, { id: 2, slug: 'renamed-page', published: 1, is_private: 1 })
    // Made private in the same save as the rename: the new path is private too.
    await redirects.redirectIfSlugChanged('post', { id: 3, slug: 'was-public', published: 1, is_private: 0 }, { id: 3, slug: 'now-private', published: 1, is_private: 1 })
    assert.deepStrictEqual(await rows(), before)

    // A public rename still redirects.
    await redirects.redirectIfSlugChanged('post', { id: 4, slug: 'old-public', published: 1, is_private: 0 }, { id: 4, slug: 'new-public', published: 1, is_private: 0 })
    assert.ok((await rows()).some((r) => r.includes('old-public') && r.includes('new-public')))
  })

  test('through the controller too', async () => {
    const before = await rows()
    const res = response()
    await PostController.update(as(ids.editor, 'editor', {
      title: 'Hidden musings', content: 'PRIVATE BODY that nobody else reads.', slug: 'hidden-musings-renamed'
    }, { id: String(ids.private) }), res)
    assert.strictEqual(res.status, 200, JSON.stringify(res.body))
    assert.strictEqual(res.body.post.slug, 'hidden-musings-renamed')
    assert.deepStrictEqual(await rows(), before)
  })

  test('a reply on a post made private sends no mail, and is not marked sent', async () => {
    const { notifyParentOfReply } = await load('src/helpers/comment-mail.ts')
    const parent = await db.run(
      "INSERT INTO comments (post_id, content, author_name, author_email, status, notify_replies) VALUES (?, 'First!', 'Reader', 'reader@example.test', 'approved', 1)",
      [ids.private]
    )
    const reply = await db.run(
      "INSERT INTO comments (post_id, content, author_name, author_email, status, parent_id) VALUES (?, 'A reply', 'Other', 'other@example.test', 'approved', ?)",
      [ids.private, Number(parent.lastInsertRowid)]
    )
    await notifyParentOfReply(Number(reply.lastInsertRowid))
    const row = await db.get('SELECT reply_notified FROM comments WHERE id = ?', [Number(reply.lastInsertRowid)])
    assert.strictEqual(Number(row.reply_notified), 0)
  })
})
