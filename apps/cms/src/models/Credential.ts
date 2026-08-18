import { getDb, query } from '@basicbenframework/core/db'

export interface CredentialRecord {
  id: number
  user_id: number
  credential_id: string
  public_key: string
  algorithm: number
  sign_count: number
  transports: string | null
  label: string | null
  backed_up: number
  last_used_at: string | null
  created_at: string
}

export const Credential = {
  async forUser(userId: number): Promise<CredentialRecord[]> {
    const db = await getDb()
    return db.all('SELECT * FROM user_credentials WHERE user_id = ? ORDER BY created_at', [userId])
  },

  async findByCredentialId(credentialId: string): Promise<CredentialRecord | undefined> {
    const db = await getDb()
    return db.get('SELECT * FROM user_credentials WHERE credential_id = ?', [credentialId])
  },

  async create(data: Record<string, unknown>): Promise<CredentialRecord | undefined> {
    const credentials = await query('user_credentials')
    await credentials.insert(data)
    return this.findByCredentialId(data.credential_id as string)
  },

  async recordUse(id: number, signCount: number): Promise<void> {
    const db = await getDb()
    await db.run(
      'UPDATE user_credentials SET sign_count = ?, last_used_at = ? WHERE id = ?',
      [signCount, new Date().toISOString(), id]
    )
  },

  async delete(userId: number, id: number): Promise<boolean> {
    const db = await getDb()
    // Scoped by user so one account cannot remove another's passkey.
    const result = await db.run('DELETE FROM user_credentials WHERE id = ? AND user_id = ?', [id, userId])
    return (result.changes ?? 0) > 0
  },

  async countForUser(userId: number): Promise<number> {
    const db = await getDb()
    const row = await db.get('SELECT COUNT(*) as count FROM user_credentials WHERE user_id = ?', [userId])
    return Number(row?.count ?? 0)
  }
}
