import { getDb, query } from '@basicbenframework/core/db'
import type { Tag as TagType } from '../types'

interface CreateTagData {
  name: string
  slug?: string
}

interface UpdateTagData {
  name?: string
  slug?: string
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export const Tag = {
  async all(): Promise<TagType[]> {
    const db = await getDb()
    return db.all(`
      SELECT t.*, COUNT(pt.post_id) as post_count
      FROM tags t
      LEFT JOIN post_tags pt ON pt.tag_id = t.id
      LEFT JOIN posts p ON p.id = pt.post_id AND p.published = 1
      GROUP BY t.id
      ORDER BY t.name ASC
    `)
  },

  async find(id: number): Promise<TagType | undefined> {
    const db = await getDb()
    return db.get(`
      SELECT t.*, COUNT(pt.post_id) as post_count
      FROM tags t
      LEFT JOIN post_tags pt ON pt.tag_id = t.id
      LEFT JOIN posts p ON p.id = pt.post_id AND p.published = 1
      WHERE t.id = ?
      GROUP BY t.id
    `, [id])
  },

  async findBySlug(slug: string): Promise<TagType | undefined> {
    const db = await getDb()
    return db.get(`
      SELECT t.*, COUNT(pt.post_id) as post_count
      FROM tags t
      LEFT JOIN post_tags pt ON pt.tag_id = t.id
      LEFT JOIN posts p ON p.id = pt.post_id AND p.published = 1
      WHERE t.slug = ?
      GROUP BY t.id
    `, [slug])
  },

  async findByIds(ids: number[]): Promise<TagType[]> {
    if (ids.length === 0) return []
    const db = await getDb()
    const placeholders = ids.map(() => '?').join(', ')
    return db.all(`SELECT * FROM tags WHERE id IN (${placeholders})`, ids)
  },

  async findByPostId(postId: number): Promise<TagType[]> {
    const db = await getDb()
    return db.all(`
      SELECT t.*
      FROM tags t
      JOIN post_tags pt ON pt.tag_id = t.id
      WHERE pt.post_id = ?
      ORDER BY t.name ASC
    `, [postId])
  },

  async create(data: CreateTagData): Promise<TagType> {
    const db = await getDb()
    const slug = data.slug || slugify(data.name)

    // Through the query builder, which appends RETURNING id on Postgres. A raw
    // INSERT there reports lastInsertRowid as null, so the row is written and
    // the caller is handed an object with no id — the failure looks like a bug
    // in whatever used the id next.
    const result = await (await query('tags')).insert({ name: data.name, slug })

    return {
      id: result.lastInsertRowid as number,
      name: data.name,
      slug,
      created_at: new Date().toISOString(),
      post_count: 0
    }
  },

  async findOrCreate(name: string): Promise<TagType> {
    const slug = slugify(name)
    const existing = await this.findBySlug(slug)
    if (existing) return existing
    return this.create({ name, slug })
  },

  async update(id: number, data: UpdateTagData): Promise<TagType> {
    const db = await getDb()

    if (data.name && !data.slug) {
      data.slug = slugify(data.name)
    }

    const fields = Object.keys(data).map(k => `${k} = ?`).join(', ')
    await db.run(
      `UPDATE tags SET ${fields} WHERE id = ?`,
      [...Object.values(data), id]
    )

    return this.find(id) as Promise<TagType>
  },

  async delete(id: number): Promise<void> {
    const db = await getDb()
    // Delete pivot table entries
    await db.run('DELETE FROM post_tags WHERE tag_id = ?', [id])
    // Delete tag
    await db.run('DELETE FROM tags WHERE id = ?', [id])
  },

  async syncToPost(postId: number, tagIds: number[]): Promise<void> {
    const db = await getDb()
    // Remove existing tags
    await db.run('DELETE FROM post_tags WHERE post_id = ?', [postId])
    // Add new tags
    for (const tagId of tagIds) {
      await db.run(
        'INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)',
        [postId, tagId]
      )
    }
  },

  async slugExists(slug: string, excludeId?: number): Promise<boolean> {
    const db = await getDb()
    const query = excludeId
      ? 'SELECT id FROM tags WHERE slug = ? AND id != ?'
      : 'SELECT id FROM tags WHERE slug = ?'
    const params = excludeId ? [slug, excludeId] : [slug]
    const result = await db.get(query, params)
    return !!result
  }
}
