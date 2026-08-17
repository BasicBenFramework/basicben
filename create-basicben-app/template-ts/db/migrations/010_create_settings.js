export const up = async (db, grammar) => {
  await db.exec(`
    CREATE TABLE settings (
      id ${grammar.autoIncrementPrimaryKey()},
      key TEXT UNIQUE NOT NULL,
      value TEXT,
      group_name TEXT DEFAULT 'general',
      created_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP,
      updated_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP
    )
  `)

  await db.exec('CREATE INDEX idx_settings_key ON settings(key)')
  await db.exec('CREATE INDEX idx_settings_group ON settings(group_name)')

  // Insert default settings
  await db.run(`
    INSERT INTO settings (key, value, group_name) VALUES
    ('site_name', 'My BasicBen Blog', 'general'),
    ('site_description', 'A blog powered by BasicBen', 'general'),
    ('posts_per_page', '10', 'reading'),
    ('allow_comments', 'true', 'discussion'),
    ('moderate_comments', 'true', 'discussion'),
    ('active_theme', 'default', 'appearance'),
    ('enabled_plugins', '[]', 'plugins')
  `)
}

export const down = async (db, grammar) => {
  await db.exec(grammar.dropTable('settings'))
}
