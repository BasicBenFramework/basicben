/**
 * Revisions: what a post said before each save.
 *
 * Written on every update that changes the title, the body or the excerpt, so
 * an editor can see what changed and put an older version back. `autosave`
 * marks the rolling copy the editor writes while someone is typing — one per
 * post and author, replaced each time, so autosaving does not bury the real
 * history under a revision every thirty seconds.
 */

export const up = async (db, grammar) => {
  await db.exec(`
    CREATE TABLE post_revisions (
      id ${grammar.autoIncrementPrimaryKey()},
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      excerpt TEXT,
      autosave INTEGER NOT NULL DEFAULT 0,
      created_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await db.exec('CREATE INDEX idx_post_revisions_post ON post_revisions(post_id, created_at)')
}

export const down = async (db) => {
  await db.exec('DROP TABLE IF EXISTS post_revisions')
}
