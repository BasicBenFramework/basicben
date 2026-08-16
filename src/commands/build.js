/**
 * build command
 * Builds the client (Vite) and prepares server for production
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { bold, cyan, green, yellow, dim, red } from '../cli/colors.js'
import { spawnBin } from '../cli/spawn.js'

export async function run(args, flags) {
  const cwd = process.cwd()
  const staticOnly = flags.static || false

  console.log(`\n${bold('BasicBen')} ${dim('build')}${staticOnly ? dim(' --static') : ''}\n`)

  // Detect if this is a TypeScript project
  const serverEntry = findServerEntry(cwd)
  const isTypeScript = serverEntry && serverEntry.endsWith('.ts')

  // Build client with Vite
  console.log(`${cyan('Building client...')}\n`)

  const outDir = staticOnly ? 'dist' : 'dist/client'
  const viteBuild = await runViteBuild(cwd, outDir)
  if (!viteBuild.success) {
    console.error(`\n${red('Client build failed')}\n`)
    process.exit(1)
  }

  console.log(`\n${green('✓')} Client built to ${dim(outDir)}\n`)

  // Static-only build stops here
  if (staticOnly) {
    console.log(`${green('Static build complete!')}\n`)
    console.log(`Deploy the ${cyan('dist/')} folder to any static host (CF Pages, Netlify, etc.)\n`)
    return
  }

  // Build server
  console.log(`${cyan('Building server...')}\n`)

  if (serverEntry) {
    // Use Vite SSR build for both TypeScript and JavaScript projects
    const serverBuild = await runViteSSRBuild(cwd, serverEntry)
    if (!serverBuild.success) {
      console.error(`\n${red('Server build failed')}\n`)
      process.exit(1)
    }
    console.log(`${green('✓')} Server compiled to ${dim('dist/server')}\n`)
  } else {
    // No custom server, copy default server files
    await prepareServer(cwd)
    console.log(`${green('✓')} Server prepared in ${dim('dist/server')}\n`)
  }

  // Summary
  console.log(`${green('Build complete!')}\n`)
  console.log(`Run ${cyan('basicben start')} to start the production server.\n`)
}

/**
 * Find server entry point
 */
function findServerEntry(cwd) {
  const candidates = [
    'src/server/index.ts',
    'src/server/index.js',
    'src/server.ts',
    'src/server.js'
  ]

  for (const candidate of candidates) {
    const fullPath = resolve(cwd, candidate)
    if (existsSync(fullPath)) {
      return candidate
    }
  }

  return null
}

/**
 * Run Vite build
 */
function runViteBuild(cwd, outDir = 'dist/client') {
  return runVite(cwd, ['build', '--outDir', outDir])
}

/**
 * Run Vite SSR build for TypeScript server
 */
function runViteSSRBuild(cwd, serverEntry) {
  return runVite(cwd, ['build', '--ssr', serverEntry, '--outDir', 'dist/server'])
}

/**
 * Run the project's Vite CLI and report whether it exited cleanly
 */
function runVite(cwd, args) {
  return new Promise((done) => {
    let proc

    try {
      proc = spawnBin(cwd, 'vite', args, {
        stdio: 'inherit',
        env: {
          ...process.env,
          NODE_ENV: 'production'
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
 * Prepare server files for production
 */
async function prepareServer(cwd) {
  const distServer = resolve(cwd, 'dist/server')

  // Create dist/server directory
  if (!existsSync(distServer)) {
    mkdirSync(distServer, { recursive: true })
  }

  // Copy server source files
  const serverDirs = ['src/server', 'src/routes', 'src/controllers', 'src/models', 'src/middleware']

  for (const dir of serverDirs) {
    const srcDir = resolve(cwd, dir)
    if (existsSync(srcDir)) {
      const destDir = resolve(distServer, dir.replace('src/', ''))
      copyDir(srcDir, destDir)
    }
  }

  // Copy package.json for production dependencies
  const pkgSrc = resolve(cwd, 'package.json')
  if (existsSync(pkgSrc)) {
    copyFileSync(pkgSrc, resolve(distServer, 'package.json'))
  }

  // Create production server entry.
  //
  // This runs only when the project has no server entry of its own — a project
  // that has one is compiled through the Vite SSR path instead. `basicben start`
  // runs this file with cwd set to the project root, and serveStatic resolves
  // its dir against cwd, so the client path is 'dist/client' rather than
  // relative to this file's location.
  const serverEntry = `
import { createServer } from '@basicbenframework/core/server'

const app = await createServer({
  static: { dir: 'dist/client', spa: true }
})

const port = process.env.PORT || 3001

app.listen(port, () => {
  console.log(\`Server running at http://localhost:\${port}\`)
})
`.trim()

  const { writeFileSync } = await import('node:fs')
  writeFileSync(resolve(distServer, 'index.js'), serverEntry)
}

/**
 * Recursively copy directory
 */
function copyDir(src, dest) {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true })
  }

  const entries = readdirSync(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
      copyFileSync(srcPath, destPath)
    }
  }
}
