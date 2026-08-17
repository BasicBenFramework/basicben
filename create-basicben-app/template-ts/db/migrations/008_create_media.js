export const up = async (db) => {
  await db.exec(`
    CREATE TABLE media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      path TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER,
      alt_text TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  await db.exec('CREATE INDEX idx_media_user ON media(user_id)')
  await db.exec('CREATE INDEX idx_media_mime ON media(mime_type)')
}

export const down = async (db) => {
  await db.exec('DROP TABLE IF EXISTS media')
}
