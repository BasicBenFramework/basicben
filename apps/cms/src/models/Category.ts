import { getDb, query } from '@basicbenframework/core/db'
import type { Category as CategoryType } from '../types'

interface CreateCategoryData {
  name: string
  slug: string
  description?: string
  parent_id?: number
}

interface UpdateCategoryData {
  name?: string
  slug?: string
  description?: string
  parent_id?: number
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export const Category = {
  async all(): Promise<CategoryType[]> {
    const db = await getDb()
    return db.all(`
      SELECT c.*, COUNT(p.id) as post_count
      FROM categories c
      LEFT JOIN posts p ON p.category_id = c.id AND p.published = 1
      GROUP BY c.id
      ORDER BY c.name ASC
    `)
  },

  async find(id: number): Promise<CategoryType | undefined> {
    const db = await getDb()
    return db.get(`
      SELECT c.*, COUNT(p.id) as post_count
      FROM categories c
      LEFT JOIN posts p ON p.category_id = c.id AND p.published = 1
      WHERE c.id = ?
      GROUP BY c.id
    `, [id])
  },

  async findBySlug(slug: string): Promise<CategoryType | undefined> {
    const db = await getDb()
    return db.get(`
      SELECT c.*, COUNT(p.id) as post_count
      FROM categories c
      LEFT JOIN posts p ON p.category_id = c.id AND p.published = 1
      WHERE c.slug = ?
      GROUP BY c.id
    `, [slug])
  },

  async tree(): Promise<CategoryType[]> {
    const categories = await this.all()
    return buildTree(categories)
  },

  async create(data: CreateCategoryData): Promise<CategoryType> {
    const db = await getDb()
    const slug = data.slug || slugify(data.name)

    // Through the query builder, which appends RETURNING id on Postgres. A raw
    // INSERT there reports lastInsertRowid as null, so the row is written and
    // the caller is handed an object with no id — the failure looks like a bug
    // in whatever used the id next.
    const result = await (await query('categories')).insert({
      name: data.name,
      slug,
      description: data.description || null,
      parent_id: data.parent_id || null
    })

    return {
      id: result.lastInsertRowid as number,
      name: data.name,
      slug,
      description: data.description,
      parent_id: data.parent_id,
      created_at: new Date().toISOString(),
      post_count: 0
    }
  },

  async update(id: number, data: UpdateCategoryData): Promise<CategoryType> {
    const db = await getDb()

    if (data.name && !data.slug) {
      data.slug = slugify(data.name)
    }

    const fields = Object.keys(data).map(k => `${k} = ?`).join(', ')
    await db.run(
      `UPDATE categories SET ${fields} WHERE id = ?`,
      [...Object.values(data), id]
    )

    return this.find(id) as Promise<CategoryType>
  },

  async delete(id: number): Promise<void> {
    const db = await getDb()
    // Update posts to remove category
    await db.run('UPDATE posts SET category_id = NULL WHERE category_id = ?', [id])
    // Update children to remove parent
    await db.run('UPDATE categories SET parent_id = NULL WHERE parent_id = ?', [id])
    // Delete category
    await db.run('DELETE FROM categories WHERE id = ?', [id])
  },

  async slugExists(slug: string, excludeId?: number): Promise<boolean> {
    const db = await getDb()
    const query = excludeId
      ? 'SELECT id FROM categories WHERE slug = ? AND id != ?'
      : 'SELECT id FROM categories WHERE slug = ?'
    const params = excludeId ? [slug, excludeId] : [slug]
    const result = await db.get(query, params)
    return !!result
  }
}

function buildTree(categories: CategoryType[], parentId: number | null = null): CategoryType[] {
  return categories
    .filter(cat => cat.parent_id === parentId)
    .map(cat => ({
      ...cat,
      children: buildTree(categories, cat.id)
    }))
}
