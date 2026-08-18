/**
 * migrate:status command
 * Shows which migrations have run
 */

import { createMigrator } from '../db/migrator.js'
import { green, yellow, cyan, dim, red } from '../cli/colors.js'

export async function run(args, flags) {
  try {
    const migrator = await createMigrator()
    const status = await migrator.status()

    if (status.length === 0) {
      console.log(`\n${yellow('No migrations found.')}\n`)
      return
    }

    console.log(`\n${cyan('Migration status:')}\n`)

    const maxNameLen = Math.max(...status.map(s => s.name.length))

    for (const migration of status) {
      const name = migration.name.padEnd(maxNameLen)
      const statusIcon = migration.ran ? green('✓ Ran') : yellow('○ Pending')
      const batch = migration.batch ? dim(` (batch ${migration.batch})`) : ''

      console.log(`  ${statusIcon}  ${name}${batch}`)
    }

    const ranCount = status.filter(s => s.ran).length
    const pendingCount = status.filter(s => !s.ran).length

    console.log()
    console.log(`  ${green('Ran:')} ${ranCount}  ${yellow('Pending:')} ${pendingCount}`)
    console.log()
  } catch (err) {
    console.error(`\n${red('Error:')}\n${err.message}\n`)
    process.exit(1)
  }
}
