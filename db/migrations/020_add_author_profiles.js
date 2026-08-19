/**
 * Every user gets an author profile.
 *
 * A post has always carried a `user_id`, and every byline the site renders came
 * from `users.name` — the whole of what a reader could learn about whoever
 * wrote it. There was nowhere to put a biography, a link, or a face, so a
 * multi-author site had authors in the database and none on the page.
 *
 * `name` stays the display name rather than gaining a `display_name` beside it.
 * Two columns that both mean "what goes on the byline" is the kind of pair that
 * disagrees within a week, and every existing byline already reads `name`.
 *
 * `slug` is the author archive segment — `/author/jane-doe`, and `?author=` on
 * the content API. Backfilled here so every account that already exists is
 * addressable the moment this runs, deduplicated because two people called Jane
 * Doe is a fact about the world rather than an error.
 */

import { slugify } from '@basicbenframework/core/content'

export const up = async (db) => {
  await db.exec('ALTER TABLE users ADD COLUMN slug TEXT')
  await db.exec('ALTER TABLE users ADD COLUMN bio TEXT')
  await db.exec('ALTER TABLE users ADD COLUMN website TEXT')
  await db.exec('ALTER TABLE users ADD COLUMN avatar_id INTEGER REFERENCES media(id)')

  const users = await db.all('SELECT id, name FROM users ORDER BY id ASC')
  const taken = new Set()

  for (const user of users) {
    // A name that slugifies to nothing — one written entirely in a script the
    // slugifier drops — still needs a URL, so it falls back to the id.
    const base = slugify(user.name || '') || `author-${user.id}`

    let slug = base
    let suffix = 2

    while (taken.has(slug)) slug = `${base}-${suffix++}`

    taken.add(slug)

    await db.run('UPDATE users SET slug = ? WHERE id = ?', [slug, user.id])
  }

  // Unique rather than merely indexed: the slug is a URL, and two authors
  // answering at one address is a bug you find in production. Rows written
  // before this migration are all filled in above, and the model fills in
  // every one written after.
  await db.exec('CREATE UNIQUE INDEX idx_users_slug ON users(slug)')
  await db.exec('CREATE INDEX idx_users_avatar ON users(avatar_id)')
}

export const down = async (db) => {
  await db.exec('DROP INDEX IF EXISTS idx_users_slug')
  await db.exec('DROP INDEX IF EXISTS idx_users_avatar')
  await db.exec('ALTER TABLE users DROP COLUMN avatar_id')
  await db.exec('ALTER TABLE users DROP COLUMN website')
  await db.exec('ALTER TABLE users DROP COLUMN bio')
  await db.exec('ALTER TABLE users DROP COLUMN slug')
}
