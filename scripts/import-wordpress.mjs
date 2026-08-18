#!/usr/bin/env node
/**
 * Import posts from the existing WordPress site into this CMS.
 *
 * Run it as often as you like: posts are matched on slug, so a second run
 * updates what changed rather than duplicating anything. That matters because
 * the useful way to cut over is to import now, keep publishing on WordPress,
 * and re-run immediately before flipping traffic across.
 *
 * Usage:
 *   node --env-file=.env scripts/import-wordpress.mjs [options]
 *
 *   --dry-run     report what would change, write nothing
 *   --limit N     only the N most recent posts, for a quick look
 *   --skip-media  leave the media library alone
 *   --url URL     override WORDPRESS_URL
 *
 * ## What is and is not carried across
 *
 * Media is catalogued, not copied. The whole library comes across as rows
 * recording the object key each file already has, served through
 * `storage.publicUrl` — so images resolve when the storage driver points at the
 * host already serving them (S3_PUBLIC_URL). If your WordPress media sits on
 * the WordPress host itself rather than on object storage, migrate the files
 * first or those URLs will not resolve.
 *
 * Importing only the images posts *point at* is not enough, and was the first
 * version of this. Pictures inside post bodies keep displaying either way,
 * because the stored HTML carries absolute URLs — but the library holds only
 * what was imported, so anything missed cannot be browsed or reused when
 * writing. `--skip-media` opts out.
 *
 * Categories are many-to-many here as they are in WordPress, so a post keeps
 * all of them. The first is also recorded on the post row as its primary
 * category, which is what a breadcrumb or canonical URL would name.
 *
 * They used to be folded into tags — the schema allowed one category per post,
 * and the alternative was dropping them. On the first real migration that
 * demoted 67 of 83 categories, which preserved the words and lost the meaning.
 *
 * Content is stored twice, deliberately. `content_html` is WordPress's own
 * rendered HTML, which is what the blog renders, so the site looks byte-identical
 * after the cutover. `content` is that HTML converted to Markdown, because this
 * CMS edits Markdown — storing HTML there would show raw tags in the editor and
 * make `?format=markdown` a lie. Editing a post in the admin re-renders the HTML
 * from the Markdown, so an edited post may differ cosmetically from WordPress's
 * output. That only happens to posts you actually edit.
 */

import { getDb } from '@basicbenframework/core/db'
import TurndownService from 'turndown'
import he from 'he'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitFlag = args.indexOf('--limit')
const limit = limitFlag === -1 ? null : Number(args[limitFlag + 1])
const skipMedia = args.includes('--skip-media')
const urlFlag = args.indexOf('--url')
const WORDPRESS_URL = (
  urlFlag === -1 ? process.env.WORDPRESS_URL : args[urlFlag + 1]
)?.replace(/\/$/, '')

if (!WORDPRESS_URL) {
  console.error('Set WORDPRESS_URL in .env, or pass --url https://example.com')
  process.exit(1)
}

if (limitFlag !== -1 && (!Number.isInteger(limit) || limit < 1)) {
  console.error('--limit needs a positive whole number')
  process.exit(1)
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-'
})

// Turndown drops anything it has no rule for, and figure/iframe are the two
// that carry real content here — an embedded video would vanish silently.
turndown.keep(['figure', 'iframe', 'video', 'table'])

/** WordPress renders entities; everything downstream wants the text. */
const decode = (value) => he.decode(String(value ?? ''))

/**
 * The plain-text summary, matching what the blog used to compute at render
 * time. Doing it here means the CMS stores a clean excerpt and the blog stops
 * needing an HTML stripper.
 */
function plainExcerpt(html) {
  return decode(
    String(html ?? '')
      .replace(/<[^>]+>/g, '')
      .replace(/\[&hellip;\]/g, '...')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/** WordPress dates are local-with-no-zone; `date_gmt` is the one to trust. */
function timestamp(post) {
  const raw = post.date_gmt ? `${post.date_gmt}Z` : post.date
  const parsed = new Date(raw)

  if (Number.isNaN(parsed.getTime())) return new Date().toISOString()

  return parsed.toISOString().replace('T', ' ').slice(0, 19)
}

/**
 * The object key behind a media URL.
 *
 * `https://cdn.example.com/2025/11/x.jpeg` is stored as `2025/11/x.jpeg`,
 * because `publicUrl()` prepends the configured domain. Storing the absolute
 * URL instead would produce `/uploads/https%3A%2F%2F...` on any driver.
 */
function objectKey(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ''))
  } catch {
    return null
  }
}

/**
 * Every item from a WordPress collection, following its paging.
 *
 * WordPress answers 400 rather than an empty array once you ask past the last
 * page, which is why that is a break and not an error.
 */
async function fetchAll(resource, query = '') {
  const items = []
  let page = 1

  while (true) {
    const endpoint =
      `${WORDPRESS_URL}/wp-json/wp/v2/${resource}?per_page=100&page=${page}${query}`
    const response = await fetch(endpoint)

    if (response.status === 400 && page > 1) break // past the last page
    if (!response.ok) throw new Error(`WordPress returned ${response.status} for ${resource} page ${page}`)

    const batch = await response.json()

    if (!Array.isArray(batch) || batch.length === 0) break

    items.push(...batch)

    const totalPages = Number(response.headers.get('x-wp-totalpages') || '1')

    if (page >= totalPages) break

    page++
  }

  return items
}

const fetchAllPosts = () => fetchAll('posts', '&_embed')
const fetchAllMedia = () => fetchAll('media')

/**
 * Bring the whole media library across, not only the images posts point at.
 *
 * Importing featured images alone left the library holding four rows out of
 * seventy-two: the pictures inside post bodies still displayed, because the
 * stored HTML carries absolute URLs, but nothing in the admin knew they
 * existed, so they could not be browsed or reused.
 *
 * As with featured images, nothing is uploaded. Each row records the object
 * key the file already has, so `publicUrl` rebuilds the URL it came from.
 * Keyed on that key, so re-running updates rather than duplicates — and the
 * rows are more complete than the featured-image path produces, since the
 * media endpoint reports a real byte count and a real upload date.
 */
async function importMedia(db, userId, { dryRun }) {
  const library = await fetchAllMedia()

  let created = 0
  let updated = 0
  let skipped = 0

  for (const item of library) {
    const key = objectKey(item.source_url)

    if (!key) {
      skipped++
      continue
    }

    if (dryRun) {
      const existing = await db.get('SELECT id FROM media WHERE path = ?', [key])
      console.log(`${existing ? 'update' : 'create'}  ${key}`)
      continue
    }

    const filename = key.split('/').pop()
    const altText = decode(item.alt_text || '') || null
    // The media endpoint reports this; the featured-image embed does not.
    const size = Number(item.media_details?.filesize) || null
    const existing = await db.get('SELECT id FROM media WHERE path = ?', [key])

    if (existing) {
      await db.run(
        'UPDATE media SET mime_type = ?, size = ?, alt_text = ? WHERE id = ?',
        [item.mime_type || null, size, altText, existing.id]
      )
      updated++
    } else {
      await db.run(
        `INSERT INTO media (user_id, filename, original_name, path, mime_type, size, alt_text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, filename, filename, key, item.mime_type || null, size, altText, timestamp(item)]
      )
      created++
    }
  }

  return { total: library.length, created, updated, skipped }
}

/** Insert-or-return-existing, keyed on slug. */
async function upsertTerm(db, table, { name, slug, description }) {
  const existing = await db.get(`SELECT id FROM ${table} WHERE slug = ?`, [slug])

  if (existing) return existing.id

  const columns = table === 'categories' ? '(name, slug, description)' : '(name, slug)'
  const values = table === 'categories' ? [name, slug, description ?? null] : [name, slug]
  const placeholders = values.map(() => '?').join(', ')

  const result = await db.run(
    `INSERT INTO ${table} ${columns} VALUES (${placeholders})`,
    values
  )

  return result.lastInsertRowid
}

/**
 * A media row for an image that already lives in the bucket.
 *
 * Keyed on `path`, so re-running does not accumulate duplicates of the same
 * file. Nothing is uploaded — this only records what is already there so a post
 * can reference it.
 */
async function upsertMedia(db, userId, media) {
  const key = objectKey(media.source_url)

  if (!key) return null

  const existing = await db.get('SELECT id FROM media WHERE path = ?', [key])
  const filename = key.split('/').pop()
  const altText = decode(media.alt_text || '') || null

  if (existing) {
    await db.run('UPDATE media SET alt_text = ? WHERE id = ?', [altText, existing.id])
    return existing.id
  }

  const result = await db.run(
    `INSERT INTO media (user_id, filename, original_name, path, mime_type, size, alt_text)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      filename,
      filename,
      key,
      media.mime_type || null,
      // WordPress does not report a byte count on the embed, and inventing one
      // would be worse than admitting it is unknown.
      null,
      altText
    ]
  )

  return result.lastInsertRowid
}

async function main() {
  const db = await getDb()

  const author = await db.get(
    "SELECT id, name, email FROM users WHERE role IN ('admin', 'owner') ORDER BY id ASC LIMIT 1"
  )

  if (!author) {
    console.error(
      'No admin user exists yet. Start the CMS and register — the first account\n' +
        'created becomes the admin — then run this again so imported posts have\n' +
        'an author.'
    )
    process.exit(1)
  }

  console.log(`Importing from ${WORDPRESS_URL}`)
  console.log(`Author: ${author.name} <${author.email}>`)
  if (dryRun) console.log('Dry run — nothing will be written.\n')

  // The library first, so a post's featured image links to a complete row
  // rather than the sparse one the embed can produce.
  if (!skipMedia) {
    const media = await importMedia(db, author.id, { dryRun })

    if (!dryRun) {
      console.log(
        `Media library: ${media.total} item(s) — ${media.created} created, ` +
          `${media.updated} updated${media.skipped ? `, ${media.skipped} skipped` : ''}.`
      )
    }
  }

  let posts = await fetchAllPosts()
  posts.sort((a, b) => new Date(a.date_gmt || a.date) - new Date(b.date_gmt || b.date))
  if (limit) posts = posts.slice(-limit)

  console.log(`Found ${posts.length} published post(s).\n`)

  let created = 0
  let updated = 0
  let images = 0

  for (const post of posts) {
    const slug = post.slug
    const title = decode(post.title?.rendered)
    const html = decode(post.content?.rendered ?? '')
    const markdown = turndown.turndown(html)
    const excerpt = plainExcerpt(post.excerpt?.rendered)
    const at = timestamp(post)

    const terms = post._embedded?.['wp:term'] ?? []
    const wpCategories = (terms[0] ?? []).filter((t) => t?.slug)
    const wpTags = (terms[1] ?? []).filter((t) => t?.slug)
    const featured = post._embedded?.['wp:featuredmedia']?.[0]

    if (dryRun) {
      const existing = await db.get('SELECT id FROM posts WHERE slug = ?', [slug])
      console.log(
        `${existing ? 'update' : 'create'}  ${slug}` +
          `  (${wpCategories.length} cat, ${wpTags.length} tag` +
          `${featured?.source_url ? ', image' : ''})`
      )
      continue
    }

    // The whole post lands or none of it does. Without this a failure partway
    // leaves a post with half its tags, and the re-run would not notice because
    // the post itself already exists.
    await db.transaction(async (tx) => {
      // Every category the post has, not just the first. The first is kept as
      // the primary one on the post row for breadcrumbs and canonical URLs.
      const categoryIds = []

      for (const term of wpCategories) {
        categoryIds.push(
          await upsertTerm(tx, 'categories', {
            name: decode(term.name),
            slug: term.slug,
            description: null
          })
        )
      }

      const categoryId = categoryIds[0] ?? null

      const mediaId =
        featured?.source_url && !featured.code
          ? await upsertMedia(tx, author.id, featured)
          : null

      if (mediaId) images++

      const existing = await tx.get('SELECT id FROM posts WHERE slug = ?', [slug])

      let postId

      if (existing) {
        await tx.run(
          `UPDATE posts SET title = ?, content = ?, content_html = ?, excerpt = ?,
                            published = 1, category_id = ?, featured_image = ?,
                            meta_title = ?, meta_description = ?, updated_at = ?
           WHERE id = ?`,
          [title, markdown, html, excerpt, categoryId, mediaId, title, excerpt, at, existing.id]
        )
        postId = existing.id
        updated++
      } else {
        const result = await tx.run(
          `INSERT INTO posts (user_id, title, slug, content, content_html, excerpt,
                              published, category_id, featured_image,
                              meta_title, meta_description, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
          [
            author.id, title, slug, markdown, html, excerpt,
            categoryId, mediaId, title, excerpt, at, at
          ]
        )
        postId = result.lastInsertRowid
        created++
      }

      // Both are rebuilt rather than merged: a term removed in WordPress should
      // disappear here too, and re-running must not accumulate.
      await tx.run('DELETE FROM post_tags WHERE post_id = ?', [postId])
      await tx.run('DELETE FROM post_categories WHERE post_id = ?', [postId])

      for (const id of categoryIds) {
        await tx.run(
          'INSERT INTO post_categories (post_id, category_id) VALUES (?, ?)',
          [postId, id]
        )
      }

      // Tags are tags. Categories used to be folded in here because the schema
      // allowed a post only one of them; it allows several now, so they stay
      // categories.
      const asTags = wpTags.map((t) => ({ name: decode(t.name), slug: t.slug }))

      const seen = new Set()

      for (const tag of asTags) {
        if (seen.has(tag.slug)) continue
        seen.add(tag.slug)

        const tagId = await upsertTerm(tx, 'tags', tag)
        await tx.run('INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)', [postId, tagId])
      }
    })
  }

  if (dryRun) {
    console.log('\nDry run complete.')
    return
  }

  console.log(`\nCreated ${created}, updated ${updated}, ${images} featured image(s) linked.`)

  const [{ total }] = [await db.get('SELECT COUNT(*) AS total FROM posts WHERE published = 1')]
  console.log(`${Number(total)} published post(s) in the CMS.`)
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(`\nImport failed: ${error.message}`)
    process.exit(1)
  }
)
