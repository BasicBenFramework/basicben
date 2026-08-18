/**
 * Categories become many-to-many, as they are in every CMS people arrive from.
 *
 * `posts.category_id` allowed exactly one, which is fine until you import from
 * somewhere that allows several: 59 of 70 posts in the first real migration had
 * more than one category, so 67 of 83 were demoted to tags to avoid dropping
 * them outright. They survived, but as the wrong kind of thing.
 *
 * `posts.category_id` stays, and stays meaningful: it is the *primary*
 * category — the one a breadcrumb or a canonical URL would use. Every category
 * a post has, including that one, is a row here.
 *
 * Existing rows are backfilled, so nothing has to be re-imported to keep what
 * it already had.
 */

export const up = async (db) => {
  await db.exec(`
    CREATE TABLE post_categories (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      PRIMARY KEY (post_id, category_id)
    )
  `)

  await db.exec('CREATE INDEX idx_post_categories_post ON post_categories(post_id)')
  await db.exec('CREATE INDEX idx_post_categories_category ON post_categories(category_id)')

  // Whatever each post already had becomes its first row here, so the join
  // table is authoritative from the moment it exists rather than after a
  // re-import.
  await db.exec(`
    INSERT INTO post_categories (post_id, category_id)
    SELECT id, category_id FROM posts WHERE category_id IS NOT NULL
  `)
}

export const down = async (db, grammar) => {
  await db.exec(grammar.dropTable('post_categories'))
}
