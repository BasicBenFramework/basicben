export const up = async (db, grammar) => {
  await db.exec(`
    CREATE TABLE tags (
      id ${grammar.autoIncrementPrimaryKey()},
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      created_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP
    )
  `)

  await db.exec('CREATE INDEX idx_tags_slug ON tags(slug)')
}

export const down = async (db, grammar) => {
  await db.exec(grammar.dropTable('tags'))
}
