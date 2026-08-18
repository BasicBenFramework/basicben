/**
 * migrate:rollback command
 * Rolls back the last batch of migrations
 */

import { createMigrator } from '../db/migrator.js'
import { green, yellow, cyan, dim, red } from '../cli/colors.js'

export async function run(args, flags) {
  console.log(`\n${cyan('Rolling back migrations...')}\n`)

  try {
    const migrator = await createMigrator()
    const result = await migrator.rollback()

    if (result.rolledBack.length === 0) {
      console.log(`${yellow('Nothing to rollback.')}\n`)
      return
    }

    for (const name of result.rolledBack) {
      console.log(`${green('✓')} ${name}`)
    }

    console.log(`\n${green('Rolled back:')} ${result.rolledBack.length} file(s) ${dim(`(batch ${result.batch})`)}\n`)
  } catch (err) {
    console.error(`\n${red('Rollback failed:')}\n${err.message}\n`)
    process.exit(1)
  }
}
