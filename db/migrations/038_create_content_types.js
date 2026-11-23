/**
 * Custom post types, the WordPress way: additive, and `post` stays a post.
 *
 * A recipe, a product, a podcast episode — each is a post in every way that
 * matters (an author, a body, a status, a schedule, revisions, an edit lock,
 * SEO fields, a slug) plus a few fields of its own and its own URL. Giving each
 * its own table would mean re-implementing all of that per type; WordPress and
 * Ghost both keep one table and a discriminator column, and so does this.
 *
 * `content_types` describes each type. `key` is what `posts.post_type` holds
 * and what `?type=` takes. `route_base` is where the public site puts it
 * (`/recipes/:slug`); `supports_*` turns editor panels and public behaviours
 * on and off. `hierarchical` is stored for later and always 0 for now.
 *
 * The built-in `post` row is created here with `builtin = 1`. It cannot be
 * deleted and its key and route base cannot change — `/blog/:slug` is what
 * every feed, sitemap and redirect this CMS has already handed out says.
 *
 * `posts.post_type` defaults to `'post'` and every existing row is backfilled
 * explicitly, so after this migration every post is exactly the post it was:
 * nothing that does not ask for a type sees anything different. There is no
 * foreign key from `posts.post_type` to `content_types.key` because SQLite
 * refuses ADD COLUMN with both REFERENCES and a non-null default; the admin
 * API refuses to delete a type that still has posts instead.
 *
 * Slugs stay unique across the whole posts table (the index from 009), not per
 * type. That keeps `/api/v1/posts/:slug` an unambiguous lookup and means a
 * post can change type without its slug colliding.
 *
 * Booleans are INTEGER 0/1, as everywhere else here, so the same SQL runs on
 * SQLite, libSQL and Postgres. `is_public` rather than `public`, which is a
 * keyword in standard SQL.
 */

export const up = async (db, grammar) => {
  await db.exec(`
    CREATE TABLE content_types (
      id ${grammar.autoIncrementPrimaryKey()},
      key TEXT UNIQUE NOT NULL,
      singular_label TEXT NOT NULL,
      plural_label TEXT NOT NULL,
      description TEXT,
      route_base TEXT UNIQUE NOT NULL,
      is_public INTEGER NOT NULL DEFAULT 1,
      hierarchical INTEGER NOT NULL DEFAULT 0,
      supports_excerpt INTEGER NOT NULL DEFAULT 1,
      supports_featured_image INTEGER NOT NULL DEFAULT 1,
      supports_comments INTEGER NOT NULL DEFAULT 1,
      supports_categories INTEGER NOT NULL DEFAULT 1,
      supports_tags INTEGER NOT NULL DEFAULT 1,
      supports_custom_fields INTEGER NOT NULL DEFAULT 1,
      builtin INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP,
      updated_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // The built-in type. Custom fields are off for it: a blog post's shape is
  // the one the editor already has, and turning them on is one click away.
  await db.run(`
    INSERT INTO content_types
      (key, singular_label, plural_label, description, route_base, is_public, hierarchical,
       supports_excerpt, supports_featured_image, supports_comments, supports_categories,
       supports_tags, supports_custom_fields, builtin, sort_order)
    VALUES ('post', 'Post', 'Posts', 'Blog posts', '/blog', 1, 0, 1, 1, 1, 1, 1, 0, 1, 0)
  `)

  await db.exec("ALTER TABLE posts ADD COLUMN post_type TEXT NOT NULL DEFAULT 'post'")

  // Belt and braces. The default already fills existing rows on all three
  // drivers, but "every existing post remains a normal post" is the promise
  // this migration makes, so it is also written down as a statement.
  await db.exec("UPDATE posts SET post_type = 'post' WHERE post_type IS NULL OR post_type = ''")

  // Every public listing filters on it, alongside the live-post predicate.
  await db.exec('CREATE INDEX idx_posts_post_type ON posts(post_type)')
}

export const down = async (db, grammar) => {
  await db.exec('DROP INDEX IF EXISTS idx_posts_post_type')
  await db.exec('ALTER TABLE posts DROP COLUMN post_type')
  await db.exec(grammar.dropTable('content_types'))
}
