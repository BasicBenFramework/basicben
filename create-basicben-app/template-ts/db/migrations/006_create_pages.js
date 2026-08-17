export const up = async (db) => {
  await db.exec(`
    CREATE TABLE pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      content TEXT,
      template TEXT DEFAULT 'default',
      published BOOLEAN DEFAULT 0,
      parent_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
      menu_order INTEGER DEFAULT 0,
      meta_title TEXT,
      meta_description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  await db.exec('CREATE INDEX idx_pages_slug ON pages(slug)')
  await db.exec('CREATE INDEX idx_pages_parent ON pages(parent_id)')
  await db.exec('CREATE INDEX idx_pages_published ON pages(published)')
}

export const down = async (db) => {
  await db.exec('DROP TABLE IF EXISTS pages')
}
