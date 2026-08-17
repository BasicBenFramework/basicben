#!/usr/bin/env node

/**
 * @basicbenframework/create
 *
 * Scaffolds a new BasicBen project with the recommended structure.
 *
 * Usage:
 *   npx @basicbenframework/create my-app
 *   npx @basicbenframework/create my-app --template minimal
 */

import { mkdirSync, writeFileSync, copyFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const frameworkDir = resolve(__dirname, '..')

// ANSI colors
const bold = (s) => `\x1b[1m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const cyan = (s) => `\x1b[36m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2)

  // Show help
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    showHelp()
    process.exit(0)
  }

  // Get project name
  const projectName = args[0]

  if (!projectName || projectName.startsWith('-')) {
    console.error(`\n${red('Error:')} Please provide a project name.\n`)
    console.log(`  ${cyan('npx @basicbenframework/create')} ${dim('<project-name>')}\n`)
    process.exit(1)
  }

  // Validate project name
  if (!/^[a-z0-9-_]+$/i.test(projectName)) {
    console.error(`\n${red('Error:')} Project name can only contain letters, numbers, dashes, and underscores.\n`)
    process.exit(1)
  }

  // Check for --local flag
  const useLocal = args.includes('--local')

  // --typescript/--ts are accepted and ignored: TypeScript is the only
  // template now, so existing scripts that pass the flag keep working.
  if (args.includes('--js') || args.includes('--javascript')) {
    console.log(
      `\n${yellow('Note:')} the JavaScript template has been removed — every app is TypeScript now.`
    )
    console.log(
      `${dim('Nothing forces you to write annotations; Vite compiles the app either way.')}\n`
    )
  }

  const projectDir = resolve(process.cwd(), projectName)

  // Check if directory exists
  if (existsSync(projectDir)) {
    console.error(`\n${red('Error:')} Directory "${projectName}" already exists.\n`)
    process.exit(1)
  }

  console.log()
  console.log(`${bold('Creating a new BasicBen app')} in ${cyan(projectDir)}`)
  console.log()

  // Create project directory
  mkdirSync(projectDir, { recursive: true })

  // Copy template files
  const templateDir = join(__dirname, 'template-ts')
  copyDir(templateDir, projectDir)

  // Determine basicben dependency
  let basicbenDep = 'latest'
  if (useLocal) {
    const relativePath = relative(projectDir, frameworkDir)
    basicbenDep = `file:${relativePath}`
    console.log(`${yellow('Using local framework:')} ${relativePath}\n`)
  }

  // Create package.json with project name
  const pkg = {
    name: projectName,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'basicben dev',
      build: 'basicben build',
      'build:client': 'vite build',
      'build:server': 'vite build --ssr src/server/index.ts --outDir dist/server',
      start: 'basicben start',
      test: 'basicben test',
      migrate: 'basicben migrate',
      'migrate:rollback': 'basicben migrate:rollback',
      'migrate:fresh': 'basicben migrate:fresh',
      'migrate:status': 'basicben migrate:status',
      'make:migration': 'basicben make:migration',
      'make:controller': 'basicben make:controller',
      'make:model': 'basicben make:model'
    },
    dependencies: {
      '@basicbenframework/core': basicbenDep,
      react: '^19.2.0',
      'react-dom': '^19.2.0'
    },
    devDependencies: {
      '@vitejs/plugin-react': '^6.0.5',
      vite: '^8.2.1',
      vitest: '^4.0.0',
      'typescript': '^5.8',
      '@types/node': '^24',
      '@types/react': '^19',
      '@types/react-dom': '^19'
    }
  }

  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify(pkg, null, 2) + '\n'
  )

  // Generate APP_KEY for .env
  const appKey = generateAppKey()
  const envContent = `# Application
APP_KEY=${appKey}

# Server Ports
PORT=3001              # API server
VITE_PORT=3000         # Frontend dev server

# Database (uncomment one)
# DATABASE_URL=./data.db
# DATABASE_URL=postgres://user:pass@localhost:5432/mydb
`
  writeFileSync(join(projectDir, '.env'), envContent)

  console.log(`${green('✓')} Project created successfully!\n`)

  // Install dependencies prompt
  console.log(`${bold('Next steps:')}\n`)
  console.log(`  ${cyan('cd')} ${projectName}`)
  console.log(`  ${cyan('npm install')}`)
  console.log(`  ${cyan('npm run dev')}\n`)

  console.log(`${dim('This will start the development server at http://localhost:3000')}\n`)
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`
${bold('@basicbenframework/create')} - Create a new BasicBen project

${bold('Usage:')}
  npx @basicbenframework/create ${dim('<project-name>')} [options]

${bold('Options:')}
  --local              Use local framework (for development)
  -h, --help           Show this help message

${bold('Examples:')}
  npx @basicbenframework/create my-app
  npx @basicbenframework/create my-app --local        ${dim('# Use local framework')}

${dim('Apps are TypeScript. --typescript/--ts still work, and do nothing.')}
`)
}

/**
 * Copy directory recursively
 */
function copyDir(src, dest) {
  if (!existsSync(src)) return

  mkdirSync(dest, { recursive: true })
  const entries = readdirSync(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = join(src, entry.name)
    // Rename gitignore to .gitignore (npm strips dotfiles during publish)
    const destName = entry.name === 'gitignore' ? '.gitignore' : entry.name
    const destPath = join(dest, destName)

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

/**
 * Generate a random APP_KEY
 */
function generateAppKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let key = ''
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return key
}

// Run
main().catch((err) => {
  console.error(`\n${red('Error:')} ${err.message}\n`)
  process.exit(1)
})
