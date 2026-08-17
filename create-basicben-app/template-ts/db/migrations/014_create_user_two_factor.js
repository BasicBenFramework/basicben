/**
 * Second-factor enrolment, one row per user.
 *
 * The TOTP secret is stored encrypted, so a copy of this table is not a set of
 * working second factors. Because the key is derived from APP_KEY, rotating it
 * invalidates every enrolled secret and users must re-enrol.
 *
 * totp_last_step is the replay guard: a code stays valid for its whole
 * 30-second window, so the accepted step has to be remembered or an intercepted
 * code can be used again inside it.
 */

export const up = async (db) => {
  await db.exec(`
    CREATE TABLE user_two_factor (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      totp_secret TEXT,
      totp_enabled_at DATETIME,
      totp_last_step INTEGER,
      recovery_codes TEXT,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

export const down = async (db) => {
  await db.exec('DROP TABLE IF EXISTS user_two_factor')
}
