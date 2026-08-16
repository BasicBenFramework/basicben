/**
 * Store rendered HTML alongside the Markdown source.
 *
 * `content` stays canonical and holds the Markdown. `content_html` is a cache:
 * it is rebuilt from `content` on every save and can be regenerated at any time
 * with `basicben content:rerender`. Nothing should ever write to it directly.
 *
 * Rendering at save time rather than at request time is the cheaper trade for a
 * blog, which is read far more often than it is written.
 *
 * Existing rows are backfilled through the same pipeline. Until this migration
 * runs, post content was rendered as raw unsanitized HTML, so the backfill is
 * also the point at which anything already stored stops being trusted.
 */

import { renderContent } from '@basicbenframework/core/content'

export const up = async (db) => {
  await db.exec('ALTER TABLE posts ADD COLUMN content_html TEXT')
  await db.exec('ALTER TABLE pages ADD COLUMN content_html TEXT')

  for (const table of ['posts', 'pages']) {
    const rows = await db.all(`SELECT id, content FROM ${table}`)

    for (const row of rows) {
      const html = await renderContent(row.content || '', {
        context: { table, id: row.id, migration: true }
      })

      await db.run(`UPDATE ${table} SET content_html = ? WHERE id = ?`, [html, row.id])
    }
  }
}

export const down = async (db) => {
  await db.exec('ALTER TABLE posts DROP COLUMN content_html')
  await db.exec('ALTER TABLE pages DROP COLUMN content_html')
}
