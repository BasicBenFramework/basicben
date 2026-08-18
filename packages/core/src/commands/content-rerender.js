/**
 * content:rerender command
 *
 * Rebuilds `content_html` from the Markdown in `content`.
 *
 * Storing rendered HTML buys fast reads and costs this: the cache goes stale
 * whenever the parser changes, the sanitizer's allowlist changes, or a plugin
 * that hooks `content.render` is installed or removed. This is how that debt
 * gets paid.
 *
 * It only ever writes `content_html`, never `content`, so running it is safe
 * and repeatable — worst case it produces exactly what was already there.
 */

import { renderContent } from '../content/index.js'
import { getDb } from '../db/index.js'
import { green, yellow, cyan, dim, red } from '../cli/colors.js'

const DEFAULT_TABLES = ['posts', 'pages']

export async function run(args, flags) {
  const tables = args.length > 0 ? args : DEFAULT_TABLES
  const dryRun = Boolean(flags['dry-run'])

  console.log(`\n${cyan('Rerendering content...')}${dryRun ? dim(' (dry run)') : ''}\n`)

  let db
  try {
    db = await getDb()
  } catch (err) {
    console.error(`\n${red('Could not open the database:')} ${err.message}\n`)
    process.exit(1)
  }

  let total = 0
  let changed = 0
  let failed = 0

  for (const table of tables) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
      console.error(`${red('✗')} ${table} ${dim('(not a valid table name)')}`)
      failed++
      continue
    }

    let rows
    try {
      rows = await db.all(`SELECT id, content, content_html FROM ${table}`)
    } catch (err) {
      // A template without a pages table is normal, not an error worth failing
      // the whole run over.
      console.log(`${yellow('–')} ${table} ${dim(`(skipped: ${err.message})`)}`)
      continue
    }

    for (const row of rows) {
      total++

      try {
        const html = await renderContent(row.content || '', {
          context: { table, id: row.id, rerender: true }
        })

        if (html === row.content_html) continue

        changed++
        if (!dryRun) {
          await db.run(`UPDATE ${table} SET content_html = ? WHERE id = ?`, [html, row.id])
        }
      } catch (err) {
        failed++
        console.error(`${red('✗')} ${table}#${row.id} ${dim(err.message)}`)
      }
    }

    console.log(`${green('✓')} ${table} ${dim(`(${rows.length} row(s))`)}`)
  }

  console.log(
    `\n${green(dryRun ? 'Would update:' : 'Updated:')} ${changed} of ${total} row(s)` +
    `${failed ? ` ${red(`— ${failed} failed`)}` : ''}\n`
  )

  if (failed) process.exit(1)
}
