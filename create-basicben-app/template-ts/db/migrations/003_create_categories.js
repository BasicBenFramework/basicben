export const up = async (db) => {
  await db.exec(`
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  await db.exec('CREATE INDEX idx_categories_slug ON categories(slug)')
  await db.exec('CREATE INDEX idx_categories_parent ON categories(parent_id)')
}

export const down = async (db) => {
  await db.exec('DROP TABLE IF EXISTS categories')
}
