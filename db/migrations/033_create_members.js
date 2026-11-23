/**
 * Members: the people who read the site, as opposed to the people who run it.
 *
 * A table of their own rather than rows in `users` with a `subscriber` role.
 * Every admin check in this codebase starts from `users` — `auth` reads the
 * row, the capability table reads its role — so a reader stored there is one
 * role mix-up away from the admin. Here there is nothing to mix up: a member
 * has no password, no role and no row the admin middleware will ever read.
 *
 * - `email` is stored lowercased and is unique, so one mailbox is one member.
 * - `status` is the newsletter subscription: `active` receives newsletters,
 *   `unsubscribed` does not. Either can sign in and read members-only posts;
 *   unsubscribing from mail is not leaving the site.
 * - `email_verified_at` is set the first time a magic link is followed.
 *   Members created by an admin or an import start without it.
 * - `session_version` is bumped by sign-out, which ends every session the
 *   member holds — sessions are stateless JWTs, so a counter is the only
 *   thing that can revoke one before it expires.
 * - `labels` is free text, comma separated, for segmenting by hand.
 * - `source` records how the row arrived: `signup`, `admin` or `import`.
 *
 * `member_tokens` holds magic links. `auth_tokens` cannot: its `user_id` is a
 * NOT NULL foreign key into `users`, and a sign-up link exists before there is
 * a member to point at. Only a SHA-256 of each token is stored, the same rule
 * `auth_tokens` follows, so a copy of the table signs nobody in.
 */

export const up = async (db, grammar) => {
  await db.exec(`
    CREATE TABLE members (
      id ${grammar.autoIncrementPrimaryKey()},
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      note TEXT,
      labels TEXT,
      source TEXT NOT NULL DEFAULT 'signup',
      session_version INTEGER NOT NULL DEFAULT 0,
      email_verified_at ${grammar.timestampType()},
      unsubscribed_at ${grammar.timestampType()},
      last_seen_at ${grammar.timestampType()},
      created_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP,
      updated_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // The newsletter enqueue selects by status; the admin list filters by it.
  await db.exec('CREATE INDEX idx_members_status ON members(status)')

  await db.exec(`
    CREATE TABLE member_tokens (
      id ${grammar.autoIncrementPrimaryKey()},
      member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      metadata TEXT,
      expires_at ${grammar.timestampType()} NOT NULL,
      used_at ${grammar.timestampType()},
      created_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Issuing a link revokes the earlier ones for the same address.
  await db.exec('CREATE INDEX idx_member_tokens_email ON member_tokens(email)')
}

export const down = async (db, grammar) => {
  await db.exec(grammar.dropTable('member_tokens'))
  await db.exec(grammar.dropTable('members'))
}
