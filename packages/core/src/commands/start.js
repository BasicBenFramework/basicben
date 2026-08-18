/**
 * start command
 * Runs the production server
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { bold, cyan, green, yellow, dim, red } from '../cli/colors.js'

export async function run(args, flags) {
  const cwd = process.cwd()

  console.log(`\n${bold('BasicBen')} ${dim('start')}\n`)

  // Check for built files
  const distServer = resolve(cwd, 'dist/server/index.js')
  const distClient = resolve(cwd, 'dist/client')

  if (!existsSync(distServer)) {
    console.error(`${red('Error:')} Production build not found.`)
    console.error(`\nRun ${cyan('basicben build')} first.\n`)
    process.exit(1)
  }

  if (!existsSync(distClient)) {
    console.error(`${yellow('Warning:')} Client build not found at dist/client`)
  }

  const port = flags.port || process.env.PORT || 3000

  console.log(`${green('Starting production server...')}\n`)
  console.log(`${cyan('Server')} ${dim('→')} http://localhost:${port}\n`)

  // Start the production server
  const nodeArgs = ['dist/server/index.js']

  // Add .env file if it exists
  if (existsSync(resolve(cwd, '.env'))) {
    nodeArgs.unshift('--env-file=.env')
  }

  const proc = spawn(process.execPath, nodeArgs, {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: port,
      NODE_ENV: 'production'
    }
  })

  proc.on('exit', (code) => {
    if (code !== 0) {
      console.error(`\n${red('Server exited with code')} ${code}\n`)
      process.exit(code)
    }
  })

  // Handle graceful shutdown
  const cleanup = () => {
    console.log(`\n${dim('Shutting down...')}\n`)
    proc.kill()
    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
}
