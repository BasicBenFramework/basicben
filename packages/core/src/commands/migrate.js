/**
 * migrate command
 * Runs all pending migrations
 */

import { createMigrator } from '../db/migrator.js'
import { green, yellow, cyan, dim, red } from '../cli/colors.js'

export async function run(args, flags) {
  console.log(`\n${cyan('Running migrations...')}\n`)

  try {
    const migrator = await createMigrator()
    const result = await migrator.migrate()

    if (result.ran.length === 0) {
      console.log(`${yellow('Nothing to migrate.')}\n`)
      return
    }

    for (const name of result.ran) {
      console.log(`${green('✓')} ${name}`)
    }

    console.log(`\n${green('Migrated:')} ${result.ran.length} file(s) ${dim(`(batch ${result.batch})`)}\n`)
  } catch (err) {
    console.error(`\n${red('Migration failed:')}\n${err.message}\n`)
    process.exit(1)
  }
}
