/**
 * make:migration command
 * Generates a TypeScript migration in db/migrations/
 */

import { generate, transformName, timestamp } from '../scaffolding/index.js'
import { green, red, cyan, dim } from '../cli/colors.js'

export async function run(args, flags) {
  const name = args[0]

  if (!name) {
    console.error(`\n${red('Error:')} Migration name is required`)
    console.error(`\nUsage: ${cyan('basicben make:migration <name>')}\n`)
    console.error(`Examples:`)
    console.error(`  ${dim('basicben make:migration create_users')}`)
    console.error(`  ${dim('basicben make:migration add_email_to_users')}\n`)
    process.exit(1)
  }

  const ts = timestamp()
  const names = transformName(name)

  // Extract table name from migration name
  // create_users -> users
  // add_email_to_users -> users
  let tableName = names.snake
  if (tableName.startsWith('create_')) {
    tableName = tableName.replace('create_', '')
  } else if (tableName.includes('_to_')) {
    tableName = tableName.split('_to_').pop()
  } else if (tableName.includes('_from_')) {
    tableName = tableName.split('_from_').pop()
  }

  const fileName = `${ts}_${names.snake}.ts`
  const targetPath = `db/migrations/${fileName}`

  try {
    const fullPath = generate('migration.ts', targetPath, {
      description: name.replace(/_/g, ' '),
      tableName: tableName
    })

    console.log(`\n${green('Created:')} ${targetPath}`)
    console.log(`${dim('Table:')} ${tableName}\n`)
  } catch (err) {
    console.error(`\n${red('Error:')} ${err.message}\n`)
    process.exit(1)
  }
}
