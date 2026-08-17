/**
 * Long-lived API tokens, for programs rather than people.
 *
 * Only a hash of the token is stored, so a copy of this table does not let
 * anyone read the site's content API.
 *
 * Unlike the migrations before it, this one asks the Grammar for its types
 * rather than writing SQLite's `INTEGER PRIMARY KEY AUTOINCREMENT` literally.
 * A headless setup is the case most likely to be on Postgres, and a table that
 * cannot be created there would make the feature SQLite-only without saying so.
 */

import { Grammar } from '@basicbenframework/core/db'

interface MigrationDb {
  exec: (sql: string) => Promise<void>
  driver?: string
}

export const up = async (db: MigrationDb) => {
  const grammar = new Grammar(db.driver || 'sqlite')

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

export const down = async (db: MigrationDb) => {
  await db.exec('DROP TABLE IF EXISTS api_tokens')
}
