/**
 * Custom taxonomies: ways of grouping content beyond categories and tags.
 *
 * A recipe site wants "cuisine" and "diet"; a podcast wants "season". Each is a
 * row in `taxonomies` — a key, labels, whether its terms nest, and which
 * content types it applies to (`taxonomy_content_types`). Its terms live in
 * `terms`, and which posts carry which terms in `term_relationships`.
 *
 * Categories and tags are **not** moved into these tables, and that is on
 * purpose. They predate this by thirty-odd migrations: `posts.category_id`,
 * `post_categories`, `post_tags`, their admin screens, the importers, the
 * exporter, feeds scoped by `?category=`, menus linking to a category id and
 * the `/api/v1/categories` shape all read them directly. Folding them into a
 * generic table would rewrite every one of those reads at once — on live
 * data, on three drivers — for a gain nobody would see. So the two built-ins
 * keep their own tables and every behaviour they have, and this generalises
 * *beside* them: anything new is a custom taxonomy. `category` and `tag` are
 * reserved as taxonomy keys so the two can never be confused in `?taxonomy[]`.
 *
 * Term slugs are unique within their taxonomy, not globally, so "Italian" can
 * be both a cuisine and a language without one of them becoming `italian-2`.
 */

export const up = async (db, grammar) => {
  await db.exec(`
    CREATE TABLE taxonomies (
      id ${grammar.autoIncrementPrimaryKey()},
      key TEXT UNIQUE NOT NULL,
      singular_label TEXT NOT NULL,
      plural_label TEXT NOT NULL,
      description TEXT,
      hierarchical INTEGER NOT NULL DEFAULT 0,
      is_public INTEGER NOT NULL DEFAULT 1,
      created_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP,
      updated_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP
    )
  `)

  await db.exec(`
    CREATE TABLE taxonomy_content_types (
      taxonomy_id INTEGER NOT NULL REFERENCES taxonomies(id) ON DELETE CASCADE,
      content_type_id INTEGER NOT NULL REFERENCES content_types(id) ON DELETE CASCADE,
      PRIMARY KEY (taxonomy_id, content_type_id)
    )
  `)

  await db.exec(`
    CREATE TABLE terms (
      id ${grammar.autoIncrementPrimaryKey()},
      taxonomy_id INTEGER NOT NULL REFERENCES taxonomies(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      parent_id INTEGER REFERENCES terms(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (taxonomy_id, slug)
    )
  `)

  await db.exec('CREATE INDEX idx_terms_parent ON terms(parent_id)')

  await db.exec(`
    CREATE TABLE term_relationships (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      term_id INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
      PRIMARY KEY (post_id, term_id)
    )
  `)

  // The primary key covers lookups by post; archives look up by term.
  await db.exec('CREATE INDEX idx_term_relationships_term ON term_relationships(term_id)')
}

export const down = async (db, grammar) => {
  await db.exec(grammar.dropTable('term_relationships'))
  await db.exec(grammar.dropTable('terms'))
  await db.exec(grammar.dropTable('taxonomy_content_types'))
  await db.exec(grammar.dropTable('taxonomies'))
}
