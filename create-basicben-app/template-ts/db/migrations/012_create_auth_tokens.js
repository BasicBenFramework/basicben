/**
 * Short-lived credentials: email verification, password reset, and anything
 * else handed out as an opaque string with an expiry.
 *
 * Only a hash of the token is stored, so a copy of this table does not let
 * anyone verify an address or reset a password.
 */

export const up = async (db) => {
  await db.exec(`
    CREATE TABLE auth_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      metadata TEXT,
      expires_at DATETIME NOT NULL,
      used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Redemption looks a token up by its hash on every request that carries one.
  await db.exec('CREATE INDEX idx_auth_tokens_hash ON auth_tokens (token_hash, kind)')
  await db.exec('CREATE INDEX idx_auth_tokens_user ON auth_tokens (user_id, kind)')
}

export const down = async (db) => {
  await db.exec('DROP TABLE IF EXISTS auth_tokens')
}
