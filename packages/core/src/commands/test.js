/**
 * test command
 * Runs Vitest for user app tests
 */

import { bold, cyan, dim, red } from '../cli/colors.js'
import { spawnBin } from '../cli/spawn.js'

export async function run(args, flags) {
  const cwd = process.cwd()

  console.log(`\n${bold('BasicBen')} ${dim('test')}\n`)

  // Build vitest args
  const vitestArgs = [...args]

  // Add common flags
  if (flags.watch || flags.w) {
    // Default is watch mode, no flag needed
  } else if (!args.includes('--watch')) {
    vitestArgs.push('--run') // Run once and exit
  }

  if (flags.coverage) {
    vitestArgs.push('--coverage')
  }

  if (flags.ui) {
    vitestArgs.push('--ui')
  }

  console.log(`${cyan('Running tests with Vitest...')}\n`)

  let proc

  try {
    proc = spawnBin(cwd, 'vitest', vitestArgs, {
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'test'
      }
    })
  } catch (err) {
    console.error(`${red(err.message)}\n`)
    process.exit(1)
  }

  proc.on('exit', (code) => {
    process.exit(code || 0)
  })
}
