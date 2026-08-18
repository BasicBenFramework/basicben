/**
 * migrate:fresh command
 * Drops all tables and re-runs all migrations
 */

import { createMigrator } from '../db/migrator.js'
import { green, yellow, cyan, dim, red } from '../cli/colors.js'

export async function run(args, flags) {
  console.log(`\n${yellow('Dropping all tables...')}\n`)

  try {
    const migrator = await createMigrator()
    const result = await migrator.fresh()

    console.log(`${cyan('Running migrations...')}\n`)

    if (result.ran.length === 0) {
      console.log(`${yellow('No migrations to run.')}\n`)
      return
    }

    for (const name of result.ran) {
      console.log(`${green('✓')} ${name}`)
    }

    console.log(`\n${green('Fresh migration complete:')} ${result.ran.length} file(s)\n`)
  } catch (err) {
    console.error(`\n${red('Fresh migration failed:')}\n${err.message}\n`)
    process.exit(1)
  }
}
