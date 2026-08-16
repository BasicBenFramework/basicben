/**
 * make:middleware command
 * Generates a middleware file in src/middleware/
 */

import { generate, transformName } from '../scaffolding/index.js'
import { green, red, cyan, dim } from '../cli/colors.js'

export async function run(args, flags) {
  const name = args[0]

  if (!name) {
    console.error(`\n${red('Error:')} Middleware name is required`)
    console.error(`\nUsage: ${cyan('basicben make:middleware <name>')}\n`)
    process.exit(1)
  }

  const names = transformName(name)
  const fileName = `${names.lower}.js`
  const targetPath = `src/middleware/${fileName}`

  // Use auth stub for 'auth' middleware, otherwise use generic stub
  const stubName = names.lower === 'auth' ? 'middleware-auth' : 'middleware'

  try {
    const fullPath = generate(stubName, targetPath, {
      Name: names.pascal,
      name: names.camel,
      lower: names.lower
    })

    console.log(`\n${green('Created:')} ${targetPath}`)

    if (names.lower === 'auth') {
      console.log(`${dim('JWT auth middleware generated')}`)
      console.log(`${dim('Requires APP_KEY in .env')}`)
      console.log(
        `\n${dim('Exported by name, so it stays off until you attach it to the')}`
      )
      console.log(`${dim('routes that need it:')}`)
      console.log(`  ${cyan(`import { auth } from '../middleware/${fileName}'`)}`)
      console.log(
        `  ${cyan("router.get('/api/posts', auth, PostController.index)")}\n`
      )
    } else {
      console.log(`${dim('Default-exported, so it runs on every request')}\n`)
    }
  } catch (err) {
    console.error(`\n${red('Error:')} ${err.message}\n`)
    process.exit(1)
  }
}
