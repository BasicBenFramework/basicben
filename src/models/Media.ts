import { getDb } from '@basicbenframework/core/db'
import { insertRow } from '../helpers/insert-row.ts'
import type { Media as MediaType } from '../types/index.ts'

interface CreateMediaData {
  user_id?: number
  filename: string
  original_name: string
  path: string
  mime_type?: string
  size?: number
  alt_text?: string
  width?: number | null
  height?: number | null
}

interface UpdateMediaData {
  alt_text?: string
}

export const Media = {
  /**
   * A page of media, optionally filtered.
   *
   * Search and type are applied in SQL rather than by the caller because the
   * result is paginated: filtering the twenty rows a page happens to hold would
   * search the current page instead of the library.
   *
   * @param page - 1-based
   * @param perPage
   * @param filters - `search` matches the original filename; `type` is a mime
   *   prefix such as 'image', or 'other' for anything that is not image, video
   *   or audio. `servedAt` is the path of a URL the file is served from: it
   *   matches the item whose storage key that path ends with, which is how a
   *   pasted URL is turned back into the library item it points at.
   */
  async all(
    page = 1,
    perPage = 20,
    filters: { search?: string; type?: string; servedAt?: string } = {}
  ): Promise<{ items: MediaType[]; total: number }> {
    const db = await getDb()
    const offset = (page - 1) * perPage

    const where: string[] = []
    const params: unknown[] = []

    if (filters.search) {
      where.push('m.original_name LIKE ?')
      params.push(`%${filters.search}%`)
    }

    if (filters.servedAt) {
      // Every storage driver serves a key at a URL ending in that key, after
      // whatever prefix its bucket, CDN or local route adds. So the key is one
      // of the path's whole-segment suffixes: compared exactly, because a
      // stored key used as a LIKE pattern would make `_` and `%` wildcards.
      const segments = filters.servedAt.split('/').filter(Boolean).slice(-20)
      const suffixes = segments.map((_, i) => segments.slice(i).join('/'))
      if (suffixes.length) {
        where.push(`m.path IN (${suffixes.map(() => '?').join(', ')})`)
        params.push(...suffixes)
      } else {
        where.push('1 = 0')
      }
    }

    if (filters.type === 'other') {
      where.push("COALESCE(m.mime_type, '') NOT LIKE 'image/%'")
      where.push("COALESCE(m.mime_type, '') NOT LIKE 'video/%'")
      where.push("COALESCE(m.mime_type, '') NOT LIKE 'audio/%'")
    } else if (filters.type) {
      where.push('m.mime_type LIKE ?')
      params.push(`${filters.type}/%`)
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const items = await db.all(`
      SELECT m.*, u.name as user_name
      FROM media m
      LEFT JOIN users u ON u.id = m.user_id
      ${clause}
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, perPage, offset])

    const countResult = await db.get(
      `SELECT COUNT(*) as total FROM media m ${clause}`,
      params
    )
    const total = countResult?.total || 0

    return { items, total }
  },

  async find(id: number): Promise<MediaType | undefined> {
    const db = await getDb()
    return db.get('SELECT * FROM media WHERE id = ?', [id])
  },

  async findByFilename(filename: string): Promise<MediaType | undefined> {
    const db = await getDb()
    return db.get('SELECT * FROM media WHERE filename = ?', [filename])
  },

  async findByUser(userId: number): Promise<MediaType[]> {
    const db = await getDb()
    return db.all(
      'SELECT * FROM media WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    )
  },

  async findByMimeType(mimeType: string): Promise<MediaType[]> {
    const db = await getDb()
    return db.all(
      'SELECT * FROM media WHERE mime_type LIKE ? ORDER BY created_at DESC',
      [`${mimeType}%`]
    )
  },

  async create(data: CreateMediaData): Promise<MediaType> {
    const db = await getDb()
    const now = new Date().toISOString()

    // Through the query builder, which appends RETURNING id on Postgres. A raw
    // INSERT there reports lastInsertRowid as null, so the row is written and
    // the caller is handed an object with no id.
    const result = await insertRow('media', {
      user_id: data.user_id || null,
      filename: data.filename,
      original_name: data.original_name,
      path: data.path,
      mime_type: data.mime_type || null,
      size: data.size || null,
      alt_text: data.alt_text || null,
      width: data.width ?? null,
      height: data.height ?? null,
      created_at: now
    })

    return {
      id: result.lastInsertRowid as number,
      user_id: data.user_id,
      filename: data.filename,
      original_name: data.original_name,
      path: data.path,
      mime_type: data.mime_type,
      size: data.size,
      alt_text: data.alt_text,
      width: data.width ?? null,
      height: data.height ?? null,
      created_at: now
    }
  },

  async update(id: number, data: UpdateMediaData): Promise<MediaType> {
    const db = await getDb()

    const fields = Object.keys(data).map(k => `${k} = ?`).join(', ')
    await db.run(
      `UPDATE media SET ${fields} WHERE id = ?`,
      [...Object.values(data), id]
    )

    return this.find(id) as Promise<MediaType>
  },

  async delete(id: number): Promise<MediaType | undefined> {
    const db = await getDb()
    // Get media info before deleting (for file cleanup)
    const media = await this.find(id)
    if (media) {
      // Update posts that use this as featured image
      await db.run('UPDATE posts SET featured_image = NULL WHERE featured_image = ?', [id])
      // Delete media record
      await db.run('DELETE FROM media WHERE id = ?', [id])
    }
    return media
  },

  async getTotalSize(): Promise<number> {
    const db = await getDb()
    const result = await db.get('SELECT SUM(size) as total FROM media')
    return result?.total || 0
  },

  async getStats(): Promise<{
    total: number
    images: number
    documents: number
    other: number
    totalSize: number
  }> {
    const db = await getDb()

    const total = await db.get('SELECT COUNT(*) as count FROM media')
    const images = await db.get(
      "SELECT COUNT(*) as count FROM media WHERE mime_type LIKE 'image/%'"
    )
    const documents = await db.get(
      "SELECT COUNT(*) as count FROM media WHERE mime_type LIKE 'application/pdf' OR mime_type LIKE 'application/%document%'"
    )
    const sizeResult = await db.get('SELECT SUM(size) as total FROM media')

    return {
      total: total?.count || 0,
      images: images?.count || 0,
      documents: documents?.count || 0,
      other: (total?.count || 0) - (images?.count || 0) - (documents?.count || 0),
      totalSize: sizeResult?.total || 0
    }
  }
}
