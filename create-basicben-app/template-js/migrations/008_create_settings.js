/**
 * Key/value settings.
 *
 * This template has no CMS, so it does not need most of what a settings table
 * usually holds. It needs one row: `enabled_plugins`.
 *
 * The server reads that list at boot to decide which plugins to activate, and
 * `basicben plugin activate` writes to it. Without the table the CLI has
 * nowhere to record the choice, so activation succeeded for the length of one
 * process and the server never saw it.
 */

export const up = async (db) => {
  await db.exec(`
    CREATE TABLE settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      value TEXT,
      group_name TEXT DEFAULT 'general',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  await db.exec('CREATE INDEX idx_settings_key ON settings(key)')

  await db.run(`
    INSERT INTO settings (key, value, group_name) VALUES
    ('enabled_plugins', '[]', 'plugins'),
    ('active_theme', 'default', 'appearance')
  `)
}

export const down = async (db) => {
  await db.exec('DROP TABLE IF EXISTS settings')
}
