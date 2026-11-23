#!/usr/bin/env node
/**
 * Import from a live WordPress site over its REST API.
 *
 * Posts, pages, categories, tags, comments, authors and the media library.
 * Everything is matched on slug (or object key, or address), so it is safe to
 * run as often as you like: the useful way to cut over is to import now, keep
 * publishing on WordPress, and re-run immediately before flipping traffic
 * across. Existing content is left alone unless `--update` is passed — use it
 * on that last run to pick up edits made since the first.
 *
 * For a site that is already offline, or to bring across drafts and private
 * posts without an application password, use the WXR export file instead:
 * `scripts/import-wxr.mjs`.
 *
 * Usage:
 *   node --env-file=.env scripts/import-wordpress.mjs [options]
 *
 *   --dry-run       report what would change, write nothing
 *   --update        overwrite posts, pages, terms and media that already exist
 *   --limit N       only the N most recent posts, for a quick look
 *   --skip-media    leave the media library alone
 *   --skip-pages    posts only
 *   --no-comments   skip comments
 *   --no-authors    attribute everything to the first admin, as this script
 *                   used to, instead of creating author accounts
 *   --verbose       print every row written
 *   --url URL       override WORDPRESS_URL
 *
 * Set WORDPRESS_AUTH=user:application-password to read as a signed-in user.
 * Anonymous requests see only published content, approved comments and no
 * author addresses; with it, drafts, scheduled, pending and private posts,
 * held and spam comments, and authors' email addresses come across too.
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
 * Authors become accounts with the `author` role — never more, whatever they
 * were in WordPress — and no usable password; each signs in by resetting it.
 * An author whose address already has an account here is matched to it, and
 * that account is not changed. Without WORDPRESS_AUTH the API hides
 * addresses, so new accounts get a placeholder `<slug>@imported.invalid`
 * that must be corrected before a reset can reach them.
 *
 * Content is stored twice, deliberately. `content_html` is WordPress's own
 * rendered HTML, put through the CMS's sanitizer, which is what the blog
 * renders, so the site looks the same after the cutover. `content` is that
 * HTML converted to Markdown, because this CMS edits Markdown — storing HTML
 * there would show raw tags in the editor and make `?format=markdown` a lie.
 * Editing a post in the admin re-renders the HTML from the Markdown, so an
 * edited post may differ cosmetically from WordPress's output. That only
 * happens to posts you actually edit.
 *
 * The rules shared with the other importers — matching, conversion, what an
 * author account gets — live in `scripts/lib/site-import.mjs`.
 */

import { getDb } from '@basicbenframework/core/db'
import { parseArgs } from './lib/import-common.mjs'
import { mapRestSite } from './lib/wordpress-rest.mjs'
import { runSiteImport } from './lib/site-import.mjs'

const { flags, options } = parseArgs(process.argv.slice(2), {
  flags: ['dry-run', 'update', 'skip-media', 'skip-pages', 'no-comments', 'no-authors', 'verbose'],
  options: ['limit', 'url']
})

const limit = options.limit === undefined ? null : Number(options.limit)
const WORDPRESS_URL = (options.url ?? process.env.WORDPRESS_URL)?.replace(/\/$/, '')
const AUTH = process.env.WORDPRESS_AUTH

if (!WORDPRESS_URL) {
  console.error('Set WORDPRESS_URL in .env, or pass --url https://example.com')
  process.exit(1)
}

if (options.limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
  console.error('--limit needs a positive whole number')
  process.exit(1)
}

const headers = AUTH ? { Authorization: `Basic ${Buffer.from(AUTH).toString('base64')}` } : {}

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
    const response = await fetch(endpoint, { headers })

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

/** Comments in every moderation state this credential can see. */
async function fetchComments() {
  if (!AUTH) return fetchAll('comments')

  const all = []
  for (const status of ['approve', 'hold', 'spam']) {
    const batch = await fetchAll('comments', `&status=${status}&context=edit`)
    // `context=edit` reports the state as the query named it; make it explicit.
    all.push(...batch.map((c) => ({ ...c, status: c.status ?? status })))
  }
  return all
}

async function main() {
  // Drafts and the rest need a signed-in request; anonymously, asking for
  // them is a 400, so the status filter is only sent with credentials.
  const statusQuery = AUTH ? '&status=publish,future,draft,pending,private' : ''

  console.log(`Importing from ${WORDPRESS_URL}${AUTH ? ' (authenticated)' : ''}`)

  let posts = await fetchAll('posts', `&_embed${statusQuery}`)
  posts.sort((a, b) => new Date(a.date_gmt || a.date) - new Date(b.date_gmt || b.date))
  if (limit) posts = posts.slice(-limit)

  const pages = flags['skip-pages'] ? [] : await fetchAll('pages', `&_embed${statusQuery}`)
  const media = flags['skip-media'] ? [] : await fetchAll('media')
  const categories = await fetchAll('categories')
  // Security plugins commonly close the users and comments endpoints. That
  // costs bylines or comments, not the import, so it is a warning.
  const optional = (what, promise) => promise.catch((error) => {
    console.warn(`Could not read ${what} (${error.message}); continuing without them.`)
    return []
  })

  const users = flags['no-authors'] ? [] : await optional('authors', fetchAll('users', AUTH ? '&context=edit' : ''))

  // With --limit, only the comments on the posts being imported.
  const postIds = new Set(posts.map((p) => p.id))
  const comments = flags['no-comments']
    ? []
    : (await optional('comments', fetchComments())).filter((c) => postIds.has(c.post))

  console.log(
    `Found ${posts.length} post(s), ${pages.length} page(s), ${comments.length} comment(s), ` +
      `${media.length} media item(s), ${users.length} author(s).`
  )

  const site = mapRestSite({ posts, pages, media, comments, users, categories })
  const db = await getDb()

  await runSiteImport(db, site, flags)
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(`\nImport failed: ${error.message}`)
    process.exit(1)
  }
)
