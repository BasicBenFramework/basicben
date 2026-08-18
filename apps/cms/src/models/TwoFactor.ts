import { getDb } from '@basicbenframework/core/db'

export interface TwoFactorRecord {
  user_id: number
  totp_secret: string | null
  totp_enabled_at: string | null
  totp_last_step: number | null
  recovery_codes: string | null
  failed_attempts: number
  locked_until: string | null
}

// Columns update() may write.
const UPDATABLE = [
  'totp_secret',
  'totp_enabled_at',
  'totp_last_step',
  'recovery_codes',
  'failed_attempts',
  'locked_until'
]

export const TwoFactor = {
  async find(userId: number): Promise<TwoFactorRecord | undefined> {
    const db = await getDb()
    return db.get('SELECT * FROM user_two_factor WHERE user_id = ?', [userId])
  },

  /**
   * Get the row, creating it if this user has never enrolled.
   */
  async findOrCreate(userId: number): Promise<TwoFactorRecord> {
    const existing = await this.find(userId)
    if (existing) return existing

    const db = await getDb()
    await db.run('INSERT INTO user_two_factor (user_id) VALUES (?)', [userId])

    return (await this.find(userId)) as TwoFactorRecord
  },

  async update(userId: number, data: Record<string, unknown>): Promise<TwoFactorRecord | undefined> {
    const db = await getDb()
    const entries = Object.entries(data).filter(([k]) => UPDATABLE.includes(k))

    if (entries.length === 0) return this.find(userId)

    const fields = entries.map(([k]) => `${k} = ?`).join(', ')
    await db.run(
      `UPDATE user_two_factor SET ${fields} WHERE user_id = ?`,
      [...entries.map(([, v]) => v), userId]
    )

    return this.find(userId)
  },

  async delete(userId: number): Promise<void> {
    const db = await getDb()
    await db.run('DELETE FROM user_two_factor WHERE user_id = ?', [userId])
  },

  /**
   * Whether a usable second factor is enrolled.
   *
   * A secret that was generated but never confirmed does not count — enabling
   * on generation is how people lock themselves out.
   */
  isEnabled(record?: TwoFactorRecord | null): boolean {
    return Boolean(record?.totp_enabled_at && record?.totp_secret)
  },

  parseRecoveryCodes(record?: TwoFactorRecord | null): string[] {
    if (!record?.recovery_codes) return []
    try {
      const parsed = JSON.parse(record.recovery_codes)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
}
