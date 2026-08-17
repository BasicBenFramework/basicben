/**
 * make:model command
 * Generates a model file in src/models/ as TypeScript
 */

import { generate, transformName } from '../scaffolding/index.js'
import { green, red, cyan, dim } from '../cli/colors.js'

export async function run(args, flags) {
  const name = args[0]

  if (!name) {
    console.error(`\n${red('Error:')} Model name is required`)
    console.error(`\nUsage: ${cyan('basicben make:model <Name>')}\n`)
    process.exit(1)
  }

  const names = transformName(name)
  const fileName = `${names.pascal}.ts`
  const targetPath = `src/models/${fileName}`

  try {
    const fullPath = generate('model.ts', targetPath, {
      Name: names.pascal,
      name: names.camel,
      lower: names.lower,
      pluralLower: names.pluralLower,
      tableName: names.pluralSnake
    })

    console.log(`\n${green('Created:')} ${targetPath}`)
    console.log(`${dim('Model:')} ${names.pascal}`)
    console.log(`${dim('Table:')} ${names.pluralSnake}\n`)
  } catch (err) {
    console.error(`\n${red('Error:')} ${err.message}\n`)
    process.exit(1)
  }
}
