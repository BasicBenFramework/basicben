export const up = async (db) => {
  await db.exec(`
    CREATE TABLE post_tags (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (post_id, tag_id)
    )
  `)

  await db.exec('CREATE INDEX idx_post_tags_post ON post_tags(post_id)')
  await db.exec('CREATE INDEX idx_post_tags_tag ON post_tags(tag_id)')
}

export const down = async (db) => {
  await db.exec('DROP TABLE IF EXISTS post_tags')
}
