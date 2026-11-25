/**
 * Challenges for signing in with a passkey alone, before anyone is known.
 *
 * `auth_tokens` cannot hold these: its `user_id` is required, and a
 * passwordless sign-in has no user until the authenticator answers. Only a
 * hash of the handle is stored, and a row is claimed once (`used_at`), as
 * `auth_tokens` rows are.
 */

export const up = async (db, grammar) => {
  await db.exec(`
    CREATE TABLE passkey_challenges (
      id ${grammar.autoIncrementPrimaryKey()},
      handle_hash TEXT NOT NULL,
      challenge TEXT NOT NULL,
      expires_at ${grammar.timestampType()} NOT NULL,
      used_at ${grammar.timestampType()}
    )
  `)
  await db.exec('CREATE UNIQUE INDEX idx_passkey_challenges_handle ON passkey_challenges (handle_hash)')
}

export const down = async (db, grammar) => {
  await db.exec(grammar.dropTable('passkey_challenges'))
}
