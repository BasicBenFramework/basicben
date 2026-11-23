/**
 * Read a BasicBen export back into a database.
 *
 * The counterpart of `src/helpers/export-data.ts`, for moving a site between
 * databases — SQLite to Postgres, one host to another, production into a
 * staging copy. The format is documented in docs/import-export.md.
 *
 * ## Ids are remapped, never copied
 *
 * The target may already have content, so an exported `id` means nothing
 * there. Every row is matched on its natural key (a post's slug, a user's
 * address, a file's object key, a setting's key), and every foreign key is
 * translated through what that row became. Tables are read in the export's
 * order, which is dependency order, so a reference is always to something
 * already handled. Self-references — a category's parent, a reply's parent
 * comment — are filled in on a second pass.
 *
 * ## What is and is not overwritten
 *
 * Without `update`, existing rows are matched and left alone; only new ones
 * are written, so a re-run adds nothing. With `update`, matched posts, pages,
 * terms, media and settings take the export's values. Existing user accounts
 * are never changed either way.
 *
 * Users keep their exported role — this is the same site moving, not a
 * foreign one arriving — but no export carries a password, so every imported
 * account must reset one to sign in. Two-factor enrolments, passkeys and API
 * tokens are not in the export and have to be set up again.
 *
 * ## Tables this importer does not know
 *
 * Menus and redirects may be exported by a version of the CMS newer than
 * this script. They are imported generically: matched on a natural-looking
 * column (`slug`, `key`, `path`, `source`, …), with `*_id` columns remapped
 * when they plainly name a table (`post_id`, `menu_id`, `parent_id`). A table
 * with no natural key is only imported into an empty target, since there is
 * no way to tell a duplicate from a new row.
 */

import { EXPORT_FORMAT, EXPORT_VERSION, isSecretSetting } from '../../src/helpers/export-data.ts'
import { insertRow, updateRow, tableColumns, unusablePassword, uniqueSlug, Report } from './import-common.mjs'

const KNOWN = [
  'users', 'media', 'categories', 'tags', 'posts', 'post_categories', 'post_tags',
  'post_revisions', 'pages', 'comments', 'settings'
]

const ROLES = new Set(['admin', 'editor', 'author', 'contributor', 'subscriber'])

/**
 * Parse and check an export document.
 *
 * Refuses anything that is not this format, or is a newer version than this
 * script understands — guessing at a future format is how imports corrupt.
 */
export function readExport(text) {
  let doc

  try {
    doc = typeof text === 'string' ? JSON.parse(text) : text
  } catch (error) {
    throw new Error(`The file is not valid JSON (${error.message}). A truncated download looks like this.`)
  }

  if (doc?.format !== EXPORT_FORMAT) throw new Error(`Not a ${EXPORT_FORMAT} file`)
  if (!Number.isInteger(doc.version) || doc.version > EXPORT_VERSION) {
    throw new Error(`Export version ${doc.version} is newer than this importer understands (${EXPORT_VERSION}). Update the CMS first.`)
  }
  if (!doc.tables || typeof doc.tables !== 'object') throw new Error('The export has no tables')

  return doc
}

/**
 * @param {object} db
 * @param {object} doc - from `readExport`
 * @param {object} options
 * @param {number} options.defaultAuthorId - owner for content whose author did not come across
 * @param {boolean} [options.update]
 * @param {(line: string) => void} [options.log]
 * @returns {Promise<Report>}
 */
export async function importExport(db, doc, options) {
  const { defaultAuthorId, update = false, log = () => {}, report = new Report() } = options
  const tables = doc.tables
  const rows = (name) => (Array.isArray(tables[name]) ? tables[name] : [])

  /** old id → new id, per table */
  const map = Object.fromEntries([...KNOWN, ...Object.keys(tables)].map((t) => [t, new Map()]))
  /** Posts whose terms and revisions this run writes. */
  const writtenPosts = new Set()
  const createdPosts = new Set()

  const ref = (table, id) => (id === null || id === undefined ? null : map[table].get(id) ?? null)

  // Users. Matched on address; never modified.
  const createdUsers = []
  for (const row of rows('users')) {
    const email = String(row.email ?? '').toLowerCase()
    if (!email) {
      report.count('users', 'skipped')
      continue
    }

    const existing = await db.get('SELECT id FROM users WHERE LOWER(email) = ?', [email])
    if (existing) {
      map.users.set(row.id, Number(existing.id))
      report.count('users', 'matched')
      continue
    }

    const { id: _id, avatar_id: avatarId, ...rest } = row
    const slug = row.slug ? await uniqueSlug(db, 'users', row.slug, 'author') : undefined
    const id = await insertRow(db, 'users', {
      ...rest,
      email,
      slug,
      role: ROLES.has(row.role) ? row.role : 'subscriber',
      password: unusablePassword()
    })

    map.users.set(row.id, id)
    createdUsers.push({ id, avatarId })
    log(`create  user ${email} (${row.role})`)
    report.count('users', 'created')
  }

  if (report.get('users', 'created')) {
    report.note('Imported accounts have no password (exports never carry one); each must use "forgot password" to sign in')
  }

  // Media, by object key.
  for (const row of rows('media')) {
    const existing = await db.get('SELECT id FROM media WHERE path = ?', [row.path])
    const { id: _id, ...rest } = row
    const data = { ...rest, user_id: ref('users', row.user_id) ?? defaultAuthorId }

    if (existing) {
      map.media.set(row.id, Number(existing.id))
      if (update) await updateRow(db, 'media', existing.id, data)
      report.count('media', update ? 'updated' : 'existing')
    } else {
      map.media.set(row.id, await insertRow(db, 'media', data))
      report.count('media', 'created')
    }
  }

  for (const { id, avatarId } of createdUsers) {
    const avatar = ref('media', avatarId)
    if (avatar) await updateRow(db, 'users', id, { avatar_id: avatar })
  }

  // Terms, by slug.
  for (const table of ['categories', 'tags']) {
    const created = new Set()

    for (const row of rows(table)) {
      const existing = await db.get(`SELECT id FROM ${table} WHERE slug = ?`, [row.slug])
      const { id: _id, parent_id: _parent, ...rest } = row

      if (existing) {
        map[table].set(row.id, Number(existing.id))
        if (update) await updateRow(db, table, existing.id, rest)
        report.count(table, update ? 'updated' : 'existing')
      } else {
        const id = await insertRow(db, table, rest)
        map[table].set(row.id, id)
        created.add(id)
        report.count(table, 'created')
      }
    }

    if (table === 'categories') {
      for (const row of rows(table)) {
        const id = map.categories.get(row.id)
        if (!row.parent_id || !(created.has(id) || update)) continue
        await updateRow(db, 'categories', id, { parent_id: ref('categories', row.parent_id) })
      }
    }
  }

  // Posts and pages, by slug.
  const remapContent = (row) => ({
    featured_image: ref('media', row.featured_image),
    og_image: ref('media', row.og_image),
    twitter_image: ref('media', row.twitter_image)
  })

  for (const row of rows('posts')) {
    const existing = await db.get('SELECT id FROM posts WHERE slug = ?', [row.slug])
    const { id: _id, ...rest } = row
    const data = {
      ...rest,
      ...remapContent(row),
      user_id: ref('users', row.user_id) ?? defaultAuthorId,
      category_id: ref('categories', row.category_id)
    }

    if (existing && !update) {
      map.posts.set(row.id, Number(existing.id))
      report.count('posts', 'existing')
      continue
    }

    await db.transaction(async (tx) => {
      let id
      if (existing) {
        id = Number(existing.id)
        await updateRow(tx, 'posts', id, data)
        await tx.run('DELETE FROM post_categories WHERE post_id = ?', [id])
        await tx.run('DELETE FROM post_tags WHERE post_id = ?', [id])
        report.count('posts', 'updated')
        log(`update  post ${row.slug}`)
      } else {
        id = await insertRow(tx, 'posts', data)
        createdPosts.add(id)
        report.count('posts', 'created')
        log(`create  post ${row.slug}`)
      }
      map.posts.set(row.id, id)
      writtenPosts.add(id)
    })
  }

  for (const [table, termTable, column] of [['post_categories', 'categories', 'category_id'], ['post_tags', 'tags', 'tag_id']]) {
    for (const row of rows(table)) {
      const postId = ref('posts', row.post_id)
      const termId = ref(termTable, row[column])
      if (!postId || !termId || !writtenPosts.has(postId)) continue
      await db.run(`INSERT INTO ${table} (post_id, ${column}) VALUES (?, ?)`, [postId, termId])
    }
  }

  // Revisions only for posts this run created: an existing post has its own
  // history, and appending another database's to it would interleave two.
  if (rows('post_revisions').length && (await tableColumns(db, 'post_revisions')).size) {
    for (const row of rows('post_revisions')) {
      const postId = ref('posts', row.post_id)
      if (!postId || !createdPosts.has(postId)) continue
      const { id: _id, ...rest } = row
      await insertRow(db, 'post_revisions', { ...rest, post_id: postId, user_id: ref('users', row.user_id) })
      report.count('revisions', 'created')
    }
  }

  const writtenPages = new Set()
  for (const row of rows('pages')) {
    const existing = await db.get('SELECT id FROM pages WHERE slug = ?', [row.slug])
    const { id: _id, parent_id: _parent, ...rest } = row
    const data = { ...rest, ...remapContent(row) }

    if (existing && !update) {
      map.pages.set(row.id, Number(existing.id))
      report.count('pages', 'existing')
      continue
    }

    let id
    if (existing) {
      id = Number(existing.id)
      await updateRow(db, 'pages', id, data)
      report.count('pages', 'updated')
    } else {
      id = await insertRow(db, 'pages', data)
      report.count('pages', 'created')
    }
    map.pages.set(row.id, id)
    writtenPages.add(id)
  }

  for (const row of rows('pages')) {
    const id = map.pages.get(row.id)
    if (row.parent_id && writtenPages.has(id)) {
      await updateRow(db, 'pages', id, { parent_id: ref('pages', row.parent_id) })
    }
  }

  // Comments: matched on post, time and text, so a re-run adds nothing.
  const pendingParents = []
  for (const row of rows('comments')) {
    const postId = ref('posts', row.post_id)
    if (!postId) {
      report.count('comments', 'skipped')
      continue
    }

    const existing = await db.get(
      'SELECT id FROM comments WHERE post_id = ? AND created_at = ? AND content = ?',
      [postId, row.created_at, row.content]
    )

    if (existing) {
      map.comments.set(row.id, Number(existing.id))
      report.count('comments', 'existing')
      continue
    }

    const { id: _id, parent_id: parentId, ...rest } = row
    const id = await insertRow(db, 'comments', {
      ...rest,
      post_id: postId,
      user_id: ref('users', row.user_id),
      parent_id: ref('comments', parentId)
    })
    map.comments.set(row.id, id)
    if (parentId && !ref('comments', parentId)) pendingParents.push({ id, parentId })
    report.count('comments', 'created')
  }

  for (const { id, parentId } of pendingParents) {
    const parent = ref('comments', parentId)
    if (parent) await updateRow(db, 'comments', id, { parent_id: parent })
  }

  // Settings, by key. Credential-looking keys are refused even if a
  // hand-edited file carries them, matching what the export leaves out.
  for (const row of rows('settings')) {
    if (isSecretSetting(row.key)) {
      report.count('settings', 'refused')
      continue
    }

    const existing = await db.get('SELECT id FROM settings WHERE key = ?', [row.key])
    const { id: _id, ...rest } = row

    if (existing) {
      if (update) await updateRow(db, 'settings', existing.id, rest)
      report.count('settings', update ? 'updated' : 'existing')
    } else {
      await insertRow(db, 'settings', rest)
      report.count('settings', 'created')
    }
  }

  // Everything else the export carried.
  for (const table of Object.keys(tables)) {
    if (KNOWN.includes(table)) continue
    await importGeneric(db, table, rows(table), { map, update, report, log })
  }

  return report
}

const NATURAL_KEYS = ['slug', 'key', 'from_path', 'source_path', 'source', 'from', 'path', 'location', 'name']

/** What a `target_type` value names. */
const POLYMORPHIC_TABLES = { post: 'posts', page: 'pages', category: 'categories', tag: 'tags', media: 'media' }

/** `post_id` → `posts`, `parent_id` → this table, and so on. */
function referencedTable(column, table, map) {
  if (column === 'parent_id') return table
  const base = column.slice(0, -3)
  const aliases = { author: 'users', image: 'media', avatar: 'media', featured_image: 'media', category: 'categories' }
  const candidates = [aliases[base], `${base}s`, base].filter(Boolean)
  return candidates.find((name) => map[name]) ?? null
}

async function importGeneric(db, table, list, { map, update, report, log }) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    report.note(`Table "${table}" has an unusable name and was skipped`)
    return
  }

  const columns = await tableColumns(db, table)

  if (columns.size === 0) {
    if (list.length) report.note(`The export has ${list.length} row(s) for "${table}", which this database does not have; skipped (run migrations first?)`)
    return
  }

  const naturalKey = NATURAL_KEYS.find((k) => columns.has(k) && list.some((row) => row[k] !== undefined))

  if (!naturalKey) {
    const { n } = (await db.get(`SELECT COUNT(*) AS n FROM "${table}"`)) ?? { n: 0 }
    if (Number(n) > 0) {
      report.note(`"${table}" has no natural key to match rows on and already has rows here, so it was skipped`)
      report.count(table, 'skipped', list.length)
      return
    }
  }

  const deferred = []
  const written = new Set()

  for (const row of list) {
    const { id: oldId, ...rest } = row
    const data = { ...rest }

    // A polymorphic link (`target_type` + `target_id`, as menu items use)
    // names its table in a sibling column, so the name of `target_id` says
    // nothing. Left alone, the old id would point at whatever row has that
    // id here — a menu linking to the wrong post.
    const polymorphic = 'target_type' in data && 'target_id' in data
    if (polymorphic && data.target_id !== null) {
      const target = POLYMORPHIC_TABLES[data.target_type]
      const mapped = target && map[target] ? map[target].get(data.target_id) : undefined
      if (mapped === undefined) {
        report.count(table, 'skipped (link target not imported)')
        continue
      }
      data.target_id = mapped
    }

    // Authorship columns that do not end in `_id`.
    if (data.created_by != null && map.users) data.created_by = map.users.get(data.created_by) ?? null

    for (const column of Object.keys(data)) {
      if (polymorphic && column === 'target_id') continue
      if (!column.endsWith('_id') || data[column] === null) continue
      const target = referencedTable(column, table, map)
      if (!target) continue
      if (target === table) {
        deferred.push({ oldId, column, value: data[column] })
        data[column] = null
      } else {
        data[column] = map[target].get(data[column]) ?? null
      }
    }

    const existing = naturalKey
      ? await db.get(`SELECT id FROM "${table}" WHERE "${naturalKey}" = ?`, [row[naturalKey]])
      : null

    try {
      if (existing) {
        if (oldId !== undefined) map[table].set(oldId, Number(existing.id))
        if (update) {
          await updateRow(db, table, existing.id, data)
          written.add(Number(existing.id))
        }
        report.count(table, update ? 'updated' : 'existing')
      } else {
        // A savepoint, so one row this schema rejects does not abort the rest
        // (on Postgres a failed statement poisons the whole transaction).
        const id = await db.transaction((tx) => insertRow(tx, table, data))
        if (oldId !== undefined && id !== null) map[table].set(oldId, id)
        if (id !== null) written.add(id)
        report.count(table, 'created')
        log(`create  ${table} row`)
      }
    } catch (error) {
      report.count(table, 'failed')
      report.note(`A "${table}" row could not be written: ${error.message}`)
    }
  }

  for (const { oldId, column, value } of deferred) {
    const id = map[table].get(oldId)
    const target = map[table].get(value)
    if (id && target && written.has(id)) await updateRow(db, table, id, { [column]: target })
  }
}
