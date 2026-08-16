/**
 * Passkeys. Many per user, unlike TOTP.
 *
 * The public key is exactly that — public — so it needs no encryption. What
 * matters is that credential_id is unique: it is the handle an authenticator
 * presents, and two users sharing one would make authentication ambiguous.
 *
 * sign_count detects a cloned authenticator, but many passkeys always report
 * zero, so zero means "not supported" rather than "suspicious".
 */

export const up = async (db) => {
  await db.exec(`
    CREATE TABLE user_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id TEXT NOT NULL UNIQUE,
      public_key TEXT NOT NULL,
      algorithm INTEGER NOT NULL,
      sign_count INTEGER NOT NULL DEFAULT 0,
      transports TEXT,
      label TEXT,
      backed_up INTEGER NOT NULL DEFAULT 0,
      last_used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Sign-in looks a credential up by the id the authenticator presents.
  await db.exec('CREATE INDEX idx_user_credentials_user ON user_credentials (user_id)')
}

export const down = async (db) => {
  await db.exec('DROP TABLE IF EXISTS user_credentials')
}
