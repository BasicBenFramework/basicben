export const up = async (db) => {
  // Add new columns to posts table for blogging features
  await db.exec('ALTER TABLE posts ADD COLUMN slug TEXT')
  await db.exec('ALTER TABLE posts ADD COLUMN excerpt TEXT')
  await db.exec('ALTER TABLE posts ADD COLUMN featured_image INTEGER REFERENCES media(id)')
  await db.exec('ALTER TABLE posts ADD COLUMN category_id INTEGER REFERENCES categories(id)')
  await db.exec('ALTER TABLE posts ADD COLUMN meta_title TEXT')
  await db.exec('ALTER TABLE posts ADD COLUMN meta_description TEXT')
  await db.exec('ALTER TABLE posts ADD COLUMN publish_at DATETIME')

  // Create indexes for new columns
  await db.exec('CREATE UNIQUE INDEX idx_posts_slug ON posts(slug)')
  await db.exec('CREATE INDEX idx_posts_category ON posts(category_id)')
  await db.exec('CREATE INDEX idx_posts_featured_image ON posts(featured_image)')
  await db.exec('CREATE INDEX idx_posts_published ON posts(published)')
  await db.exec('CREATE INDEX idx_posts_publish_at ON posts(publish_at)')
}

export const down = async (db) => {
  // SQLite doesn't support DROP COLUMN directly, so we need to recreate the table
  // For simplicity in rollback, we'll just drop the indexes
  await db.exec('DROP INDEX IF EXISTS idx_posts_slug')
  await db.exec('DROP INDEX IF EXISTS idx_posts_category')
  await db.exec('DROP INDEX IF EXISTS idx_posts_featured_image')
  await db.exec('DROP INDEX IF EXISTS idx_posts_published')
  await db.exec('DROP INDEX IF EXISTS idx_posts_publish_at')
}
