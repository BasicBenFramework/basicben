export const up = async (db) => {
  await db.exec(`
    CREATE TABLE comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
      author_name TEXT,
      author_email TEXT,
      content TEXT NOT NULL,
      approved BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  await db.exec('CREATE INDEX idx_comments_post ON comments(post_id)')
  await db.exec('CREATE INDEX idx_comments_user ON comments(user_id)')
  await db.exec('CREATE INDEX idx_comments_parent ON comments(parent_id)')
  await db.exec('CREATE INDEX idx_comments_approved ON comments(approved)')
}

export const down = async (db) => {
  await db.exec('DROP TABLE IF EXISTS comments')
}
