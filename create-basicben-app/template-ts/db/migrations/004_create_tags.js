export const up = async (db) => {
  await db.exec(`
    CREATE TABLE tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  await db.exec('CREATE INDEX idx_tags_slug ON tags(slug)')
}

export const down = async (db) => {
  await db.exec('DROP TABLE IF EXISTS tags')
}
