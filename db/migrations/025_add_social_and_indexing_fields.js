/**
 * What a post or page looks like when it is shared, and whether it is indexed.
 *
 * `meta_title` and `meta_description` cover the search result. A link shared
 * to a social network reads Open Graph and Twitter card tags instead, and
 * Ghost lets an editor set those separately for the same reason: the headline
 * that works in a search result is rarely the one that works in a feed.
 * Absent values fall back — og to meta to the title — in the content API, so
 * nobody has to fill in six fields to get a card.
 *
 * `canonical_url` is for a post first published somewhere else. `noindex`
 * keeps a post out of the sitemap and tells the front end to emit a robots
 * meta tag.
 *
 * Images are foreign keys into `media`, as `featured_image` is.
 */

const TABLES = ['posts', 'pages']

export const up = async (db) => {
  for (const table of TABLES) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN og_title TEXT`)
    await db.exec(`ALTER TABLE ${table} ADD COLUMN og_description TEXT`)
    await db.exec(`ALTER TABLE ${table} ADD COLUMN og_image INTEGER REFERENCES media(id)`)
    await db.exec(`ALTER TABLE ${table} ADD COLUMN twitter_title TEXT`)
    await db.exec(`ALTER TABLE ${table} ADD COLUMN twitter_description TEXT`)
    await db.exec(`ALTER TABLE ${table} ADD COLUMN twitter_image INTEGER REFERENCES media(id)`)
    await db.exec(`ALTER TABLE ${table} ADD COLUMN canonical_url TEXT`)
    await db.exec(`ALTER TABLE ${table} ADD COLUMN noindex INTEGER NOT NULL DEFAULT 0`)
  }
}

export const down = async (db) => {
  for (const table of TABLES) {
    for (const column of ['noindex', 'canonical_url', 'twitter_image', 'twitter_description',
      'twitter_title', 'og_image', 'og_description', 'og_title']) {
      await db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`)
    }
  }
}
