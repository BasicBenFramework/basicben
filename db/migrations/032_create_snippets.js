/**
 * Snippets: reusable pieces of Markdown.
 *
 * The newsletter sign-up line, the affiliate disclosure, the "this post is part
 * of a series" box — text that gets pasted into post after post and then
 * drifts, because each copy was edited by hand. A snippet is inserted into the
 * post as text, not referenced: changing a snippet later does not rewrite the
 * posts that already used it, which is what you want from a published archive.
 *
 * `created_by` is the owner, for the rule that anyone who writes may use every
 * snippet but only an editor may change someone else's. Nullable and SET NULL
 * so deleting an account keeps the snippets it wrote for everyone else.
 */

export const up = async (db, grammar) => {
  await db.exec(`
    CREATE TABLE snippets (
      id ${grammar.autoIncrementPrimaryKey()},
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP,
      updated_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await db.exec('CREATE INDEX idx_snippets_name ON snippets(name)')
}

export const down = async (db) => {
  await db.exec('DROP TABLE IF EXISTS snippets')
}
