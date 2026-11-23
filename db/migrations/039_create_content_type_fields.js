/**
 * Custom fields per content type, and where their values live.
 *
 * A recipe has a prep time and a serving count; a product has a price. Each
 * type declares its fields in `content_type_fields` — a key, a label, a type
 * (text, textarea, number, url, date, boolean or select), select options and
 * whether it is required — and the admin API validates a post's values against
 * that schema on every save.
 *
 * The values are one JSON column on `posts` rather than a key/value table
 * (WordPress's `postmeta`). Fields are always read and written as a whole
 * post's set, never queried across posts, so a JSON object is the shape the
 * code already wants, it costs no join on every read, and it travels with the
 * row into exports and the content API without extra plumbing. TEXT, not
 * JSON/JSONB, because the same column type has to exist on SQLite, libSQL and
 * Postgres.
 *
 * Null on every existing post: they have no custom fields, and the API reports
 * that as `{}`.
 */

export const up = async (db, grammar) => {
  await db.exec(`
    CREATE TABLE content_type_fields (
      id ${grammar.autoIncrementPrimaryKey()},
      content_type_id INTEGER NOT NULL REFERENCES content_types(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      label TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      options TEXT,
      required INTEGER NOT NULL DEFAULT 0,
      help_text TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (content_type_id, key)
    )
  `)

  await db.exec('CREATE INDEX idx_content_type_fields_type ON content_type_fields(content_type_id, sort_order)')

  await db.exec('ALTER TABLE posts ADD COLUMN fields TEXT')
}

export const down = async (db, grammar) => {
  await db.exec('ALTER TABLE posts DROP COLUMN fields')
  await db.exec(grammar.dropTable('content_type_fields'))
}
