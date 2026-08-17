/**
 * make:seed command
 * Generates a TypeScript seeder in db/seeds/
 */

import { generate, transformName } from '../scaffolding/index.js'
import { green, red, cyan, dim } from '../cli/colors.js'

export async function run(args, flags) {
  const name = args[0]

  if (!name) {
    console.error(`\n${red('Error:')} Seed name is required`)
    console.error(`\nUsage: ${cyan('basicben make:seed <name>')}\n`)
    console.error(`Examples:`)
    console.error(`  ${dim('basicben make:seed users')}`)
    console.error(`  ${dim('basicben make:seed sample_posts')}\n`)
    process.exit(1)
  }

  const names = transformName(name)
  const fileName = `${names.snake}.ts`
  const targetPath = `db/seeds/${fileName}`

  try {
    generate('seed.ts', targetPath, {
      name: names.pascal,
      tableName: names.pluralSnake,
      lower: names.lower
    })

    console.log(`\n${green('Created:')} ${targetPath}`)
    console.log(`${dim('Run with:')} basicben seed ${names.snake}\n`)
  } catch (err) {
    console.error(`\n${red('Error:')} ${err.message}\n`)
    process.exit(1)
  }
}
