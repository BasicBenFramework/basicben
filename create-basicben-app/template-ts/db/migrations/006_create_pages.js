export const up = async (db, grammar) => {
  await db.exec(`
    CREATE TABLE pages (
      id ${grammar.autoIncrementPrimaryKey()},
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      content TEXT,
      template TEXT DEFAULT 'default',
      published INTEGER NOT NULL DEFAULT 0,
      parent_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
      menu_order INTEGER DEFAULT 0,
      meta_title TEXT,
      meta_description TEXT,
      created_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP,
      updated_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP
    )
  `)

  await db.exec('CREATE INDEX idx_pages_slug ON pages(slug)')
  await db.exec('CREATE INDEX idx_pages_parent ON pages(parent_id)')
  await db.exec('CREATE INDEX idx_pages_published ON pages(published)')
}

export const down = async (db, grammar) => {
  await db.exec(grammar.dropTable('pages'))
}
