/**
 * make:route command
 * Generates a route file in src/routes/api/ as TypeScript
 */

import { generate, transformName } from '../scaffolding/index.js'
import { green, red, cyan, dim } from '../cli/colors.js'

export async function run(args, flags) {
  const name = args[0]

  if (!name) {
    console.error(`\n${red('Error:')} Route name is required`)
    console.error(`\nUsage: ${cyan('basicben make:route <name>')}\n`)
    process.exit(1)
  }

  const names = transformName(name)
  const fileName = `${names.lower}.ts`
  const targetPath = `src/routes/api/${fileName}`

  try {
    const fullPath = generate('route.ts', targetPath, {
      Name: names.pascal,
      name: names.camel,
      lower: names.lower,
      pluralLower: names.pluralLower
    })

    console.log(`\n${green('Created:')} ${targetPath}`)
    console.log(`${dim('Routes:')} /${names.pluralLower}\n`)
  } catch (err) {
    console.error(`\n${red('Error:')} ${err.message}\n`)
    process.exit(1)
  }
}
