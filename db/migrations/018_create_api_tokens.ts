/**
 * Long-lived API tokens, for programs rather than people.
 *
 * Only a hash of the token is stored, so a copy of this table does not let
 * anyone read the site's content API.
 */

interface MigrationDb {
  exec: (sql: string) => Promise<void>
}

interface Grammar {
  autoIncrementPrimaryKey: () => string
  timestampType: () => string
  dropTable: (table: string) => string
}

export const up = async (db: MigrationDb, grammar: Grammar) => {
  await db.exec(`
    CREATE TABLE api_tokens (
      id ${grammar.autoIncrementPrimaryKey()},
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      scopes TEXT NOT NULL,
      last_used_at ${grammar.timestampType()},
      expires_at ${grammar.timestampType()},
      created_at ${grammar.timestampType()} NOT NULL
    )
  `)

  // Every authenticated request looks a token up by its hash. The column is
  // already UNIQUE, which indexes it on both drivers, so the lookup is covered.
  await db.exec('CREATE INDEX idx_api_tokens_user ON api_tokens (user_id)')
}

export const down = async (db: MigrationDb, grammar: Grammar) => {
  await db.exec(grammar.dropTable('api_tokens'))
}
