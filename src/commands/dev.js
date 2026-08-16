/**
 * dev command
 * Starts Vite dev server (port 3000) and Node API server (port 3001)
 * Vite proxies /api/* requests to Node
 */

import { spawn, execSync } from 'node:child_process'
import { existsSync, readFileSync, watch } from 'node:fs'
import { resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bold, cyan, green, yellow, dim, red } from '../cli/colors.js'
import { spawnBin } from '../cli/spawn.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Load .env file into process.env
 */
function loadEnv(cwd) {
  const envPath = resolve(cwd, '.env')
  if (!existsSync(envPath)) return

  const content = readFileSync(envPath, 'utf-8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const [key, ...rest] = trimmed.split('=')
    if (key && rest.length) {
      let value = rest.join('=').trim()
      // Strip inline comments (but not if inside quotes)
      if (!value.startsWith('"') && !value.startsWith("'")) {
        const commentIndex = value.indexOf('#')
        if (commentIndex !== -1) {
          value = value.substring(0, commentIndex).trim()
        }
      }
      process.env[key.trim()] = value
    }
  }
}

export async function run(args, flags) {
  const cwd = process.cwd()

  // Load .env file
  loadEnv(cwd)

  console.log(`\n${bold('BasicBen')} ${dim('dev')}\n`)

  // Find server entry (uses framework default if no custom server)
  const serverEntry = findServerEntry(cwd)
  const isTypeScript = serverEntry && serverEntry.endsWith('.ts')

  const viteConfig = findViteConfig(cwd)

  // Start Node server with --watch
  const nodePort = flags.port || process.env.PORT || 3001

  let nodeProcess

  if (isTypeScript) {
    // TypeScript: Build with Vite first, then run compiled JS
    console.log(`${cyan('Compiling TypeScript server...')}\n`)

    // Get relative path for Vite
    const relativeEntry = relative(cwd, serverEntry)

    const buildResult = await buildServerWithVite(cwd, relativeEntry)
    if (!buildResult.success) {
      console.error(`${red('Failed to compile server')}\n`)
      process.exit(1)
    }

    // Run the compiled JavaScript
    const compiledEntry = resolve(cwd, 'dist/server/index.js')
    nodeProcess = startNodeServer(compiledEntry, nodePort, cwd)

    // Watch for TypeScript changes and rebuild
    startTypeScriptWatcher(cwd, relativeEntry, nodeProcess, nodePort)
  } else {
    // JavaScript: Run directly with --watch
    nodeProcess = startNodeServer(serverEntry, nodePort, cwd)
  }

  // Start Vite dev server
  const vitePort = flags.vitePort || process.env.VITE_PORT || 3000

  let viteProcess
  try {
    viteProcess = startViteServer(vitePort, nodePort, viteConfig, cwd)
  } catch (err) {
    console.error(`\n${red(err.message)}\n`)
    nodeProcess.kill()
    process.exit(1)
  }

  // Handle process cleanup
  const cleanup = () => {
    console.log(`\n${dim('Shutting down...')}\n`)
    nodeProcess.kill()
    viteProcess.kill()
    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  // Wait for both processes
  nodeProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`${red('Node server exited with code')} ${code}`)
    }
  })

  viteProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`${red('Vite exited with code')} ${code}`)
    }
    cleanup()
  })
}

/**
 * Find server entry point
 * Returns default framework entry if no custom server exists
 */
function findServerEntry(cwd) {
  const candidates = [
    'src/server/index.ts',
    'src/server/index.js',
    'src/server.ts',
    'src/server.js',
    'src/index.ts',
    'src/index.js',
    'server/index.ts',
    'server/index.js',
    'server.ts',
    'server.js'
  ]

  for (const candidate of candidates) {
    const fullPath = resolve(cwd, candidate)
    if (existsSync(fullPath)) {
      return fullPath
    }
  }

  // No custom server found, use framework default
  return resolve(__dirname, '../server/default-entry.js')
}

/**
 * Find Vite config
 */
function findViteConfig(cwd) {
  const candidates = [
    'vite.config.js',
    'vite.config.ts',
    'vite.config.mjs'
  ]

  for (const candidate of candidates) {
    const fullPath = resolve(cwd, candidate)
    if (existsSync(fullPath)) {
      return fullPath
    }
  }

  return null
}

/**
 * Start Node server with --watch flag
 */
function startNodeServer(entry, port, cwd) {
  console.log(`${cyan('API')}    ${dim('→')} http://localhost:${port}`)

  const nodeArgs = [
    '--watch',
    '--env-file=.env'
  ]

  // Add .env file if it exists
  if (!existsSync(resolve(cwd, '.env'))) {
    nodeArgs.splice(1, 1) // Remove --env-file if no .env
  }

  nodeArgs.push(entry)

  const proc = spawn(process.execPath, nodeArgs, {
    cwd,
    stdio: ['inherit', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: port,
      NODE_ENV: 'development'
    }
  })

  // Prefix output with [API]
  proc.stdout?.on('data', (data) => {
    const lines = data.toString().trim().split('\n')
    for (const line of lines) {
      if (line) console.log(`${dim('[API]')} ${line}`)
    }
  })

  proc.stderr?.on('data', (data) => {
    const lines = data.toString().trim().split('\n')
    for (const line of lines) {
      if (line) console.error(`${dim('[API]')} ${line}`)
    }
  })

  return proc
}

/**
 * Start Vite dev server with proxy config
 */
function startViteServer(port, apiPort, configPath, cwd) {
  console.log(`${green('Vite')}   ${dim('→')} http://localhost:${port}`)
  console.log()

  const viteArgs = [
    '--port', String(port),
    '--strictPort'
  ]

  if (configPath) {
    viteArgs.push('--config', configPath)
  }

  return spawnBin(cwd, 'vite', viteArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: apiPort,
      NODE_ENV: 'development'
    }
  })
}

/**
 * Build server with Vite SSR (for TypeScript)
 */
function buildServerWithVite(cwd, serverEntry) {
  return new Promise((done) => {
    let proc

    try {
      proc = spawnBin(cwd, 'vite', [
        'build',
        '--ssr', serverEntry,
        '--outDir', 'dist/server'
      ], {
        stdio: 'pipe',
        env: {
          ...process.env,
          NODE_ENV: 'development'
        }
      })
    } catch (err) {
      console.error(`\n${red(err.message)}`)
      done({ success: false })
      return
    }

    proc.on('exit', (code) => {
      done({ success: code === 0 })
    })

    proc.on('error', () => {
      done({ success: false })
    })
  })
}

/**
 * Watch for TypeScript changes and rebuild server
 */
function startTypeScriptWatcher(cwd, serverEntry, nodeProcess, nodePort) {
  const srcDir = resolve(cwd, 'src')

  // Debounce rebuilds
  let rebuildTimeout = null
  let isRebuilding = false

  const rebuild = async () => {
    if (isRebuilding) return
    isRebuilding = true

    console.log(`\n${dim('[API]')} ${cyan('Rebuilding...')}`)

    const result = await buildServerWithVite(cwd, serverEntry)

    if (result.success) {
      console.log(`${dim('[API]')} ${green('Rebuilt successfully')}`)
      // Node --watch will automatically restart when dist/server/index.js changes
    } else {
      console.log(`${dim('[API]')} ${red('Build failed')}`)
    }

    isRebuilding = false
  }

  // Use fs.watch to monitor src directory for .ts changes
  const watcher = watch(srcDir, { recursive: true }, (eventType, filename) => {
    if (!filename) return

    // Only watch TypeScript files in server-related directories
    const isServerFile = filename.endsWith('.ts') && (
      filename.startsWith('server') ||
      filename.startsWith('controllers') ||
      filename.startsWith('models') ||
      filename.startsWith('middleware') ||
      filename.startsWith('routes/api') ||
      filename.startsWith('helpers')
    )

    if (isServerFile) {
      // Debounce: wait 100ms before rebuilding
      if (rebuildTimeout) clearTimeout(rebuildTimeout)
      rebuildTimeout = setTimeout(rebuild, 100)
    }
  })

  return watcher
}
