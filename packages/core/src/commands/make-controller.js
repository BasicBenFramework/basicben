/**
 * make:controller command
 * Generates a controller file in src/controllers/ as TypeScript
 */

import { generate, transformName } from '../scaffolding/index.js'
import { green, red, cyan, dim } from '../cli/colors.js'

export async function run(args, flags) {
  const name = args[0]

  if (!name) {
    console.error(`\n${red('Error:')} Controller name is required`)
    console.error(`\nUsage: ${cyan('basicben make:controller <Name>')}\n`)
    process.exit(1)
  }

  const names = transformName(name)
  const fileName = `${names.pascal}Controller.ts`
  const targetPath = `src/controllers/${fileName}`

  try {
    const fullPath = generate('controller.ts', targetPath, {
      Name: names.pascal,
      name: names.camel,
      lower: names.lower,
      pluralLower: names.pluralLower
    })

    console.log(`\n${green('Created:')} ${targetPath}`)
    console.log(`${dim('Controller:')} ${names.pascal}Controller\n`)
  } catch (err) {
    console.error(`\n${red('Error:')} ${err.message}\n`)
    process.exit(1)
  }
}
