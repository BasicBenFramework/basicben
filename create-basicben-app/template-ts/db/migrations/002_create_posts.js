export const up = async (db, grammar) => {
  await db.exec(`
    CREATE TABLE posts (
      id ${grammar.autoIncrementPrimaryKey()},
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      published INTEGER NOT NULL DEFAULT 0,
      created_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP,
      updated_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `)
}

export const down = async (db, grammar) => {
  await db.exec(grammar.dropTable('posts'))
}
