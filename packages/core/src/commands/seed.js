/**
 * seed command
 * Runs database seeders to populate data
 */

import { createSeeder } from '../db/seeder.js'
import { green, yellow, cyan, dim, red } from '../cli/colors.js'

export async function run(args, flags) {
  const seedName = args[0]

  if (seedName) {
    console.log(`\n${cyan(`Running seed: ${seedName}...`)}\n`)
  } else {
    console.log(`\n${cyan('Running all seeds...')}\n`)
  }

  try {
    const seeder = await createSeeder()

    // Run specific seed or all seeds
    const result = seedName
      ? await seeder.run(seedName)
      : await seeder.runAll()

    if (result.ran.length === 0) {
      console.log(`${yellow('No seeds to run.')}\n`)

      // Show hint if no seeds directory
      const available = seeder.list()
      if (available.length === 0) {
        console.log(`${dim('Create seed files in db/seeds/ directory.')}`)
        console.log(`${dim('Run: basicben make:seed <name>')}\n`)
      }
      return
    }

    for (const name of result.ran) {
      console.log(`${green('✓')} ${name}`)
    }

    console.log(`\n${green('Seeded:')} ${result.ran.length} file(s)\n`)
  } catch (err) {
    console.error(`\n${red('Seed failed:')}\n${err.message}\n`)
    process.exit(1)
  }
}
