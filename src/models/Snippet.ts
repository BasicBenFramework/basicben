import { getDb } from '@basicbenframework/core/db'
import { insertRow } from '../helpers/insert-row.ts'

/**
 * Reusable Markdown, inserted into posts as text.
 *
 * Plain rows and a shared library: everyone who writes sees every snippet,
 * because the point is that the disclosure paragraph is written once for the
 * whole site. Who may change one is the controller's business.
 */

export interface SnippetRow {
  id: number
  name: string
  content: string
  created_by: number | null
  author_name: string | null
  created_at: string
  updated_at: string
}

const SELECT = `
  SELECT snippets.id, snippets.name, snippets.content, snippets.created_by,
         snippets.created_at, snippets.updated_at, users.name AS author_name
  FROM snippets
  LEFT JOIN users ON users.id = snippets.created_by
`

export const Snippet = {
  /**
   * Every snippet, by name, optionally narrowed by a search on the name.
   *
   * Capped rather than paginated: this feeds a picker in the editor, and a
   * library of more than a few hundred snippets wants search, not paging.
   */
  async all(search?: string): Promise<SnippetRow[]> {
    const db = await getDb()

    if (search) {
      // LOWER on both sides because Postgres LIKE is case-sensitive and SQLite's
      // is not; the result should not depend on the driver.
      return db.all(
        `${SELECT} WHERE LOWER(snippets.name) LIKE ? ORDER BY snippets.name ASC LIMIT 500`,
        [`%${search.toLowerCase()}%`]
      )
    }

    return db.all(`${SELECT} ORDER BY snippets.name ASC LIMIT 500`)
  },

  async find(id: number): Promise<SnippetRow | undefined> {
    const db = await getDb()
    return db.get(`${SELECT} WHERE snippets.id = ?`, [id])
  },

  async create(data: { name: string; content: string; created_by: number }): Promise<SnippetRow | undefined> {
    // Timestamps written explicitly as ISO strings, as everywhere else here:
    // SQLite's CURRENT_TIMESTAMP default is a different, zone-less format.
    const now = new Date().toISOString()
    // Through the query builder, which appends RETURNING id on Postgres; a raw
    // INSERT there reports no id (see Tag.create).
    const result = await insertRow('snippets', {
      name: data.name,
      content: data.content,
      created_by: data.created_by,
      created_at: now,
      updated_at: now
    })
    return Snippet.find(Number(result.lastInsertRowid))
  },

  async update(id: number, data: { name?: string; content?: string }): Promise<SnippetRow | undefined> {
    const db = await getDb()
    const sets: string[] = []
    const values: unknown[] = []

    if (data.name !== undefined) { sets.push('name = ?'); values.push(data.name) }
    if (data.content !== undefined) { sets.push('content = ?'); values.push(data.content) }

    sets.push('updated_at = ?')
    values.push(new Date().toISOString(), id)

    await db.run(`UPDATE snippets SET ${sets.join(', ')} WHERE id = ?`, values)
    return Snippet.find(id)
  },

  async delete(id: number): Promise<void> {
    const db = await getDb()
    await db.run('DELETE FROM snippets WHERE id = ?', [id])
  }
}
