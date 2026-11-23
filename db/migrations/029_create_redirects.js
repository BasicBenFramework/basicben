/**
 * Redirects: old URLs that should keep working.
 *
 * The CMS is headless, so it does not answer requests for `/blog/old-slug` —
 * the front end does. What the CMS can do is keep the list: `/api/v1/redirects`
 * hands it to the front end, which applies it (a build step writing a
 * `_redirects` file, or edge middleware).
 *
 * Rows come from two places, told apart by `source`: an admin typing one in
 * (`manual`), or a published post or page changing its slug (`post`, `page`),
 * which records a 301 from the old path so links and search results already
 * out in the world do not 404.
 *
 * `from_path` is stored normalised — leading slash, no trailing slash, no query
 * — and is unique, so a path has exactly one destination. `hits` counts
 * lookups made through `?path=`; a front end that applies the whole list
 * itself cannot report back, so treat it as a lower bound.
 */

export const up = async (db, grammar) => {
  await db.exec(`
    CREATE TABLE redirects (
      id ${grammar.autoIncrementPrimaryKey()},
      from_path TEXT UNIQUE NOT NULL,
      to_path TEXT NOT NULL,
      status INTEGER NOT NULL DEFAULT 301,
      source TEXT NOT NULL DEFAULT 'manual',
      hits INTEGER NOT NULL DEFAULT 0,
      created_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP,
      updated_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Chain collapsing looks rows up by destination.
  await db.exec('CREATE INDEX idx_redirects_to_path ON redirects(to_path)')
}

export const down = async (db, grammar) => {
  await db.exec(grammar.dropTable('redirects'))
}
