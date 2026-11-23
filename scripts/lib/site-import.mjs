/**
 * Write a normalized site into the database.
 *
 * Every foreign-CMS importer — WXR, Ghost, the WordPress REST API — reads its
 * source into the same plain shape (below) and hands it here, so the rules
 * about what is created, what is skipped and what is converted live in one
 * place instead of drifting between three scripts.
 *
 * ## The site shape
 *
 *   authors:    { key, name, email?, slug?, bio?, website?, avatarUrl? }
 *   categories: { key, name, slug, description?, parentKey? }
 *   tags:       { key, name, slug }
 *   media:      { key?, url, mimeType?, alt?, size?, width?, height?, createdAt? }
 *   posts:      { key, type: 'post' | 'page', title, slug, html?, markdown?,
 *                 excerpt?, status: 'published' | 'draft' | 'pending',
 *                 publishAt?, createdAt?, updatedAt?, trashed?, authorKey?,
 *                 categoryKeys?, tagKeys?, featuredImage? (url or media key),
 *                 parentKey?, menuOrder?, template?,
 *                 seo?: { meta_title, meta_description, og_title, og_description,
 *                         og_image, twitter_title, twitter_description,
 *                         twitter_image, canonical_url, noindex } }
 *   comments:   { key, postKey, parentKey?, authorName?, authorEmail?,
 *                 userKey?, html, status: 'approved' | 'pending' | 'spam',
 *                 createdAt? }
 *
 * `key` is whatever identifies the thing in the source (a WordPress id, a
 * Ghost ObjectId) and is only used to connect records to each other here.
 *
 * ## The rules
 *
 * - Matched on slug (posts, pages, terms), address (users) or object key
 *   (media). An existing row is left alone unless `update` is set; it is still
 *   *used*, so a new post can be filed under a category that already existed.
 * - Existing user accounts are never modified, even with `update`: an import
 *   file must not be able to rename, re-role or re-password a real account.
 * - New authors are created as `author`, never anything more, with a password
 *   nothing matches. They sign in by resetting it.
 * - Content is converted once, here. `content` is Markdown (what this CMS
 *   edits); `content_html` is the source's HTML put through the same sanitizer
 *   the content pipeline ends with, so the site looks as it did and nothing
 *   unsafe is stored. Editing a post re-renders the HTML from the Markdown.
 */

import { sanitizeHtml, renderContent, excerpt as excerptOf, slugify } from '@basicbenframework/core/content'
import { htmlToMarkdown, commentText } from './html-to-markdown.mjs'
import {
  insertRow,
  updateRow,
  tableColumns,
  toTimestamp,
  objectKey,
  mimeFromName,
  unusablePassword,
  uniqueSlug,
  withDryRun,
  defaultAuthor,
  NO_ADMIN_MESSAGE,
  Report
} from './import-common.mjs'

/**
 * @param {object} db
 * @param {object} site - see the shape above
 * @param {object} options
 * @param {number} options.defaultAuthorId - who owns content with no author
 * @param {boolean} [options.update] - overwrite matching rows
 * @param {boolean} [options.authors] - create authors (default true); false attributes everything to the default
 * @param {boolean} [options.comments] - import comments (default true)
 * @param {boolean} [options.media] - import media rows (default true)
 * @param {(line: string) => void} [options.log]
 * @param {Report} [options.report]
 * @returns {Promise<Report>}
 */
export async function importSite(db, site, options) {
  const {
    defaultAuthorId,
    update = false,
    log = () => {},
    report = new Report()
  } = options

  const wantAuthors = options.authors !== false
  const wantComments = options.comments !== false
  const wantMedia = options.media !== false
  const now = new Date().toISOString()

  const ids = {
    authors: new Map(),
    categories: new Map(),
    tags: new Map(),
    media: new Map(), // url and media key → id
    posts: new Map(), // post key → { table, id }
    pageParents: []
  }

  // Authors
  for (const author of wantAuthors ? site.authors ?? [] : []) {
    ids.authors.set(author.key, await importAuthor(db, author, { report, log, now, ids }))
  }

  // Media: the library first, so posts link to the complete row rather than a
  // sparse one made up from a featured-image reference.
  const mediaFor = async (ref) => {
    if (!ref || !wantMedia) return null
    if (ids.media.has(ref)) return ids.media.get(ref)
    if (!/^https?:\/\//i.test(ref)) return null
    const id = await importMedia(db, { url: ref }, { report, log, update, defaultAuthorId })
    ids.media.set(ref, id)
    return id
  }

  for (const item of wantMedia ? site.media ?? [] : []) {
    const id = await importMedia(db, item, { report, log, update, defaultAuthorId })
    if (item.key) ids.media.set(item.key, id)
    ids.media.set(item.url, id)
  }

  // Author avatars point into the library, so they wait for it.
  for (const author of wantAuthors ? site.authors ?? [] : []) {
    const userId = ids.authors.get(author.key)
    if (userId?.created && author.avatarUrl) {
      const avatar = await mediaFor(author.avatarUrl)
      if (avatar) await updateRow(db, 'users', userId.id, { avatar_id: avatar })
    }
  }

  // Terms
  for (const category of site.categories ?? []) {
    ids.categories.set(category.key, await importTerm(db, 'categories', category, { report, log, update }))
  }

  // Parents after every category exists, since a WXR file is free to list a
  // child before its parent.
  for (const category of site.categories ?? []) {
    if (!category.parentKey) continue
    const id = ids.categories.get(category.key)
    const parent = ids.categories.get(category.parentKey)
    if (!id || !parent || id.id === parent.id) continue
    if (id.created || update) await updateRow(db, 'categories', id.id, { parent_id: parent.id })
  }

  for (const tag of site.tags ?? []) {
    ids.tags.set(tag.key, await importTerm(db, 'tags', tag, { report, log, update }))
  }

  // Posts and pages
  for (const item of site.posts ?? []) {
    await db.transaction(async (tx) => {
      await importItem(tx, item, { report, log, update, now, ids, defaultAuthorId, mediaFor })
    })
  }

  for (const { id, parentKey } of ids.pageParents) {
    const parent = ids.posts.get(parentKey)
    if (parent?.table === 'pages' && parent.id !== id) {
      await updateRow(db, 'pages', id, { parent_id: parent.id })
    } else if (parentKey) {
      report.note('A page\'s parent was not in the import, so it was left at the top level')
    }
  }

  // Comments
  if (wantComments) await importComments(db, site.comments ?? [], { report, log, ids })

  return report
}

async function importAuthor(db, author, { report, log, now }) {
  const email = (author.email || `${slugify(author.slug || author.name || '') || 'author'}@imported.invalid`).toLowerCase()

  const existing = await db.get('SELECT id FROM users WHERE LOWER(email) = ?', [email])

  if (existing) {
    report.count('authors', 'matched')
    return { id: Number(existing.id), created: false }
  }

  if (!author.email) {
    report.note('Some authors had no email address in the source; they were given <slug>@imported.invalid — set the real address before they reset a password')
  }

  const slug = await uniqueSlug(db, 'users', slugify(author.slug || author.name || ''), 'author')
  const id = await insertRow(db, 'users', {
    name: author.name || slug,
    email,
    password: unusablePassword(),
    // Never more than this, whatever the source said: an export file must not
    // be a way to mint administrators.
    role: 'author',
    slug,
    bio: author.bio || null,
    website: author.website || null,
    // Unverified until they reset the password, which proves the address.
    email_verified: 0,
    created_at: toTimestamp(author.createdAt) ?? now
  })

  log(`create  author ${slug} <${email}>`)
  report.count('authors', 'created')
  return { id, created: true }
}

async function importMedia(db, item, { report, log, update, defaultAuthorId }) {
  const key = objectKey(item.url)

  if (!key) {
    report.count('media', 'skipped')
    report.note('Media with a URL that could not be parsed was skipped')
    return null
  }

  const existing = await db.get('SELECT id FROM media WHERE path = ?', [key])
  const filename = key.split('/').pop() || key
  const row = {
    mime_type: item.mimeType || mimeFromName(filename),
    // Unknown is null. Inventing a byte count would be worse than admitting it.
    size: Number(item.size) || null,
    alt_text: item.alt || null,
    width: Number(item.width) || null,
    height: Number(item.height) || null
  }

  if (existing) {
    if (update) {
      await updateRow(db, 'media', existing.id, row)
      report.count('media', 'updated')
    } else {
      report.count('media', 'existing')
    }
    return Number(existing.id)
  }

  const id = await insertRow(db, 'media', {
    user_id: defaultAuthorId,
    filename,
    original_name: filename,
    path: key,
    ...row,
    created_at: toTimestamp(item.createdAt) ?? undefined
  })

  log(`create  media ${key}`)
  report.count('media', 'created')
  return id
}

async function importTerm(db, table, term, { report, log, update }) {
  const slug = term.slug || slugify(term.name || '')
  const entity = table === 'categories' ? 'categories' : 'tags'

  if (!slug) {
    report.count(entity, 'skipped')
    return null
  }

  const existing = await db.get(`SELECT id FROM ${table} WHERE slug = ?`, [slug])
  const row = table === 'categories'
    ? { name: term.name || slug, description: term.description || null }
    : { name: term.name || slug }

  if (existing) {
    if (update) {
      await updateRow(db, table, existing.id, row)
      report.count(entity, 'updated')
    } else {
      report.count(entity, 'existing')
    }
    return { id: Number(existing.id), created: false }
  }

  const id = await insertRow(db, table, { ...row, slug })
  log(`create  ${table === 'categories' ? 'category' : 'tag'} ${slug}`)
  report.count(entity, 'created')
  return { id, created: true }
}

async function importItem(db, item, { report, log, update, now, ids, defaultAuthorId, mediaFor }) {
  const isPage = item.type === 'page'
  const table = isPage ? 'pages' : 'posts'
  const entity = isPage ? 'pages' : 'posts'
  const slug = item.slug || slugify(item.title || '')

  if (!slug) {
    report.count(entity, 'skipped')
    report.note(`An untitled ${isPage ? 'page' : 'post'} with no slug was skipped`)
    return
  }

  const existing = await db.get(`SELECT id FROM ${table} WHERE slug = ?`, [slug])

  if (existing && !update) {
    // Still recorded, so comments and child pages can attach to it.
    // Its parent is left as it is, too.
    ids.posts.set(item.key, { table, id: Number(existing.id), created: false })
    report.count(entity, 'existing')
    return
  }

  const html = item.html ?? null
  const markdown = item.markdown ?? (html ? htmlToMarkdown(html) : '')
  const contentHtml = html ? sanitizeHtml(html) : await renderContent(markdown, { filter: false })
  const createdAt = toTimestamp(item.createdAt) ?? toTimestamp(item.publishAt) ?? now
  const updatedAt = toTimestamp(item.updatedAt) ?? createdAt
  const publishAt = toTimestamp(item.publishAt)
  const published = item.status === 'published'
  const seo = item.seo ?? {}

  const featured = await mediaFor(item.featuredImage)

  const shared = {
    title: item.title || slug,
    slug,
    content: markdown,
    content_html: contentHtml,
    featured_image: featured,
    meta_title: seo.meta_title || null,
    meta_description: seo.meta_description || null,
    og_title: seo.og_title || null,
    og_description: seo.og_description || null,
    og_image: await mediaFor(seo.og_image),
    twitter_title: seo.twitter_title || null,
    twitter_description: seo.twitter_description || null,
    twitter_image: await mediaFor(seo.twitter_image),
    canonical_url: seo.canonical_url || null,
    noindex: seo.noindex ? 1 : 0,
    created_at: createdAt,
    updated_at: updatedAt
  }

  let row

  if (isPage) {
    row = {
      ...shared,
      // Pages have no schedule and no review state: live or not.
      published: published && !(publishAt && publishAt > now) ? 1 : 0,
      template: item.template || 'default',
      menu_order: Number(item.menuOrder) || 0
    }
    if (published && publishAt && publishAt > now) {
      report.note('Scheduled pages were imported as drafts; pages have no publish date here')
    }
  } else {
    const categoryIds = unique((item.categoryKeys ?? []).map((k) => ids.categories.get(k)?.id).filter(Boolean))
    const author = ids.authors.get(item.authorKey)?.id ?? defaultAuthorId

    row = {
      ...shared,
      user_id: author,
      excerpt: item.excerpt || excerptOf(markdown) || null,
      status: item.status || 'draft',
      published: published ? 1 : 0,
      // A published post with no date went live when it was written.
      publish_at: published ? publishAt ?? createdAt : publishAt,
      deleted_at: item.trashed ? now : null,
      // Live posts were announced by the old site; a scheduled one is
      // announced here when its time comes, by the publish-due tick.
      live_notified: published && publishAt && publishAt > now ? 0 : 1,
      category_id: categoryIds[0] ?? null
    }
    row.categoryIds = categoryIds
  }

  const { categoryIds = [] } = row
  delete row.categoryIds

  let id

  if (existing) {
    id = Number(existing.id)
    await updateRow(db, table, id, row)
    log(`update  ${isPage ? 'page' : 'post'} ${slug}`)
    report.count(entity, 'updated')
  } else {
    id = await insertRow(db, table, row)
    log(`create  ${isPage ? 'page' : 'post'} ${slug}`)
    report.count(entity, 'created')
  }

  ids.posts.set(item.key, { table, id, created: !existing })

  if (isPage) {
    if (item.parentKey) ids.pageParents.push({ id, parentKey: item.parentKey })
    return
  }

  // Rebuilt rather than merged: a term removed at the source should disappear
  // here too, and re-running must not accumulate.
  await db.run('DELETE FROM post_categories WHERE post_id = ?', [id])
  await db.run('DELETE FROM post_tags WHERE post_id = ?', [id])

  for (const categoryId of categoryIds) {
    await db.run('INSERT INTO post_categories (post_id, category_id) VALUES (?, ?)', [id, categoryId])
  }

  const tagIds = unique((item.tagKeys ?? []).map((k) => ids.tags.get(k)?.id).filter(Boolean))
  for (const tagId of tagIds) {
    await db.run('INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)', [id, tagId])
  }
}

/**
 * Comments, threaded.
 *
 * Sorted oldest first so a parent is written before its replies; a reply
 * whose parent was not imported (spam, say) is kept at the top level rather
 * than dropped. Matched on post, time and text, so re-running adds nothing.
 *
 * Spam: if the comments table has a `status` or `spam` column (the spam
 * workstream adds one), spam is imported and marked as such. Without one there
 * is nowhere to say "this is spam" short of pending, where it would sit in the
 * moderation queue looking like a real comment, so it is skipped and counted.
 */
async function importComments(db, comments, { report, log, ids }) {
  const columns = await tableColumns(db, 'comments')
  const commentIds = new Map()

  const ordered = [...comments].sort((a, b) =>
    String(toTimestamp(a.createdAt) ?? '').localeCompare(String(toTimestamp(b.createdAt) ?? ''))
  )

  for (const comment of ordered) {
    const post = ids.posts.get(comment.postKey)

    if (!post || post.table !== 'posts') {
      report.count('comments', 'skipped')
      if (post?.table === 'pages') report.note('Comments on pages were skipped; only posts have comments here')
      continue
    }

    const isSpam = comment.status === 'spam'
    const spamColumn = columns.has('status') ? 'status' : columns.has('spam') ? 'spam' : columns.has('is_spam') ? 'is_spam' : null

    if (isSpam && !spamColumn) {
      report.count('comments', 'spam skipped')
      continue
    }

    const content = commentText(comment.html)
    if (!content) {
      report.count('comments', 'skipped')
      continue
    }

    const createdAt = toTimestamp(comment.createdAt) ?? new Date().toISOString()
    const existing = await db.get(
      'SELECT id FROM comments WHERE post_id = ? AND created_at = ? AND content = ?',
      [post.id, createdAt, content]
    )

    if (existing) {
      commentIds.set(comment.key, Number(existing.id))
      report.count('comments', 'existing')
      continue
    }

    const row = {
      post_id: post.id,
      user_id: ids.authors.get(comment.userKey)?.id ?? null,
      parent_id: commentIds.get(comment.parentKey) ?? null,
      author_name: comment.authorName || null,
      author_email: comment.authorEmail || null,
      content,
      approved: comment.status === 'approved' ? 1 : 0,
      created_at: createdAt
    }

    if (spamColumn === 'status') row.status = comment.status
    else if (spamColumn) row[spamColumn] = isSpam ? 1 : 0

    const id = await insertRow(db, 'comments', row)
    commentIds.set(comment.key, id)
    log(`create  comment on post ${post.id}${row.parent_id ? ` (reply to ${row.parent_id})` : ''}`)
    report.count('comments', isSpam ? 'created as spam' : 'created')
  }
}

function unique(values) {
  return [...new Set(values)]
}

/**
 * The command-line half every foreign-CMS importer shares: find the fallback
 * author, run the import (rolled back if it is a dry run), print the report.
 *
 * @param {object} db
 * @param {object} site
 * @param {object} flags - parsed `--dry-run`, `--update`, `--verbose`, `--no-authors`, `--no-comments`, `--skip-media`
 */
export async function runSiteImport(db, site, flags) {
  const admin = await defaultAuthor(db)

  if (!admin) {
    console.error(NO_ADMIN_MESSAGE)
    process.exit(1)
  }

  console.log(`Fallback author: ${admin.name} <${admin.email}>`)
  if (flags['dry-run']) console.log('Dry run — nothing will be written.')
  if (flags.update) console.log('Updating content that already exists.')
  console.log('')

  const report = new Report()
  for (const note of site.notes ?? []) report.note(note)

  await withDryRun(db, flags['dry-run'], (tx) =>
    importSite(tx, site, {
      defaultAuthorId: admin.id,
      update: flags.update,
      authors: !flags['no-authors'],
      comments: !flags['no-comments'],
      media: !flags['skip-media'],
      log: flags.verbose || flags['dry-run'] ? console.log : undefined,
      report
    })
  )

  if (report.get('authors', 'created')) {
    report.note('New authors were created with the "author" role and no usable password; they sign in with "forgot password"')
  }
  if (report.get('media', 'created')) {
    report.note('Media rows record each file\'s existing path; files were not copied. Point storage (S3_PUBLIC_URL) at the host serving them, or move the files first')
  }

  console.log(`\n${report}`)
  if (flags['dry-run']) console.log('\nDry run complete. Nothing was written.')

  return report
}
