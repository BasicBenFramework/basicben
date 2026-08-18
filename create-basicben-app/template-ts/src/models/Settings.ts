import { getDb } from '@basicbenframework/core/db'
import type { Settings as SettingsType } from '../types'

export const Settings = {
  async all(): Promise<SettingsType[]> {
    const db = await getDb()
    return db.all('SELECT * FROM settings ORDER BY group_name, key')
  },

  async byGroup(groupName: string): Promise<SettingsType[]> {
    const db = await getDb()
    return db.all(
      'SELECT * FROM settings WHERE group_name = ? ORDER BY key',
      [groupName]
    )
  },

  async get(key: string): Promise<string | null> {
    const db = await getDb()
    const result = await db.get('SELECT value FROM settings WHERE key = ?', [key])
    return result?.value || null
  },

  async getTyped<T>(key: string, defaultValue: T): Promise<T> {
    const value = await this.get(key)
    if (value === null) return defaultValue

    try {
      return JSON.parse(value) as T
    } catch {
      return value as unknown as T
    }
  },

  async set(key: string, value: string | number | boolean | object, groupName = 'general'): Promise<void> {
    const db = await getDb()
    const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value)
    const now = new Date().toISOString()

    await db.run(`
      INSERT INTO settings (key, value, group_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
    `, [key, stringValue, groupName, now, now, stringValue, now])
  },

  async setMany(settings: Record<string, string | number | boolean | object>, groupName = 'general'): Promise<void> {
    for (const [key, value] of Object.entries(settings)) {
      await this.set(key, value, groupName)
    }
  },

  async delete(key: string): Promise<void> {
    const db = await getDb()
    await db.run('DELETE FROM settings WHERE key = ?', [key])
  },

  async asObject(groupName?: string): Promise<Record<string, string>> {
    const settings = groupName ? await this.byGroup(groupName) : await this.all()
    return settings.reduce((acc, setting) => {
      acc[setting.key] = setting.value || ''
      return acc
    }, {} as Record<string, string>)
  },

  // Convenience methods for common settings
  async getSiteName(): Promise<string> {
    return (await this.get('site_name')) || 'My BasicBen Blog'
  },

  async getSiteDescription(): Promise<string> {
    return (await this.get('site_description')) || ''
  },

  async getPostsPerPage(): Promise<number> {
    const value = await this.get('posts_per_page')
    return value ? parseInt(value, 10) : 10
  },

  async getAllowComments(): Promise<boolean> {
    const value = await this.get('allow_comments')
    return value === 'true'
  },

  async getModerateComments(): Promise<boolean> {
    const value = await this.get('moderate_comments')
    return value !== 'false' // Default to true
  },

}
