/**
 * CLI command: basicben registry
 *
 * Manage plugin registries and license keys.
 *
 * Usage:
 *   basicben registry list              List configured registries
 *   basicben registry add <url>         Add a registry
 *   basicben registry remove <url>      Remove a registry
 *   basicben registry ping <url>        Test registry connection
 *   basicben license set <key>          Set license key
 *   basicben license status             Show license status
 */

import { bold, green, yellow, red, cyan, dim } from '../cli/colors.js'
import { UpdateManager } from '../updates/index.js'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const CONFIG_FILE = '.basicbenrc.json'

export async function run(args, flags) {
  const subcommand = args[0] || 'list'

  switch (subcommand) {
    case 'list':
    case 'ls':
      await listRegistries(flags)
      break

    case 'add':
      await addRegistry(args.slice(1), flags)
      break

    case 'remove':
    case 'rm':
      await removeRegistry(args.slice(1), flags)
      break

    case 'ping':
    case 'test':
      await pingRegistry(args.slice(1), flags)
      break

    default:
      console.error(`\n${red('Error:')} Unknown subcommand: ${bold(subcommand)}`)
      showHelp()
      process.exit(1)
  }
}

/**
 * List configured registries
 */
async function listRegistries(flags) {
  console.log(`\n${bold('Configured Registries')}\n`)

  const config = await loadConfig()
  const registries = config.registries || ['https://registry.basicben.com']

  console.log(`${dim('┌' + '─'.repeat(60) + '┐')}`)
  console.log(`${dim('│')} ${bold('#'.padEnd(4))} ${bold('Registry URL'.padEnd(50))} ${dim('│')}`)
  console.log(`${dim('├' + '─'.repeat(60) + '┤')}`)

  registries.forEach((url, index) => {
    const isDefault = url === 'https://registry.basicben.com'
    const label = isDefault ? ` ${dim('(official)')}` : ''
    console.log(`${dim('│')} ${String(index + 1).padEnd(4)} ${url.padEnd(50 - stripAnsi(label).length)}${label} ${dim('│')}`)
  })

  console.log(`${dim('└' + '─'.repeat(60) + '┘')}`)
  console.log('')

  if (flags.json) {
    console.log(JSON.stringify({ registries }, null, 2))
  }
}

/**
 * Add a registry
 */
async function addRegistry(args, flags) {
  const url = args[0]

  if (!url) {
    console.error(`\n${red('Error:')} Please specify a registry URL.`)
    console.error(`\nUsage: ${cyan('basicben registry add <url>')}\n`)
    process.exit(1)
  }

  // Validate URL format
  try {
    new URL(url)
  } catch {
    console.error(`\n${red('Error:')} Invalid URL: ${url}\n`)
    process.exit(1)
  }

  console.log(`\n${bold('Adding registry:')} ${cyan(url)}\n`)

  // Test connection first
  console.log(`  Testing connection...`)

  const updates = new UpdateManager()
  const reachable = await updates.registry.pingRegistry(url)

  if (!reachable && !flags.force) {
    console.error(`\n${red('✗')} Registry is not reachable.`)
    console.error(`${dim('Use --force to add anyway.')}\n`)
    process.exit(1)
  }

  if (reachable) {
    console.log(`  ${green('✓')} Registry is reachable`)
  } else {
    console.log(`  ${yellow('!')} Registry is not reachable (adding anyway)`)
  }

  // Add to config
  const config = await loadConfig()
  if (!config.registries) {
    config.registries = ['https://registry.basicben.com']
  }

  if (config.registries.includes(url)) {
    console.log(`\n${yellow('!')} Registry already exists.\n`)
    return
  }

  config.registries.push(url)
  await saveConfig(config)

  console.log(`\n${green('✓')} Registry added.\n`)
}

/**
 * Remove a registry
 */
async function removeRegistry(args, flags) {
  const url = args[0]

  if (!url) {
    console.error(`\n${red('Error:')} Please specify a registry URL to remove.`)
    console.error(`\nUsage: ${cyan('basicben registry remove <url>')}\n`)
    process.exit(1)
  }

  // Prevent removing official registry
  if (url === 'https://registry.basicben.com' && !flags.force) {
    console.error(`\n${red('Error:')} Cannot remove the official registry.`)
    console.error(`${dim('Use --force to override.')}\n`)
    process.exit(1)
  }

  const config = await loadConfig()

  if (!config.registries?.includes(url)) {
    console.error(`\n${red('Error:')} Registry not found: ${url}\n`)
    process.exit(1)
  }

  config.registries = config.registries.filter(r => r !== url)
  await saveConfig(config)

  console.log(`\n${green('✓')} Registry removed: ${dim(url)}\n`)
}

/**
 * Test registry connection
 */
async function pingRegistry(args, flags) {
  const url = args[0]

  if (!url) {
    // Ping all configured registries
    const config = await loadConfig()
    const registries = config.registries || ['https://registry.basicben.com']

    console.log(`\n${bold('Testing registries...')}\n`)

    const updates = new UpdateManager()

    for (const registry of registries) {
      process.stdout.write(`  ${registry} ... `)
      const start = Date.now()
      const reachable = await updates.registry.pingRegistry(registry)
      const duration = Date.now() - start

      if (reachable) {
        console.log(`${green('✓')} ${dim(`(${duration}ms)`)}`)
      } else {
        console.log(`${red('✗')} ${dim('unreachable')}`)
      }
    }

    console.log('')
    return
  }

  console.log(`\n${bold('Testing registry:')} ${cyan(url)}\n`)

  const updates = new UpdateManager()
  const start = Date.now()
  const reachable = await updates.registry.pingRegistry(url)
  const duration = Date.now() - start

  if (reachable) {
    console.log(`${green('✓')} Registry is reachable ${dim(`(${duration}ms)`)}\n`)
  } else {
    console.log(`${red('✗')} Registry is not reachable\n`)
    process.exit(1)
  }
}

/**
 * Load config from .basicbenrc.json
 */
async function loadConfig() {
  try {
    const configPath = join(process.cwd(), CONFIG_FILE)
    const content = await readFile(configPath, 'utf-8')
    return JSON.parse(content)
  } catch {
    return {}
  }
}

/**
 * Save config to .basicbenrc.json
 */
async function saveConfig(config) {
  const configPath = join(process.cwd(), CONFIG_FILE)
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n')
}

/**
 * Strip ANSI codes for length calculation
 */
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}

/**
 * Show help
 */
function showHelp() {
  console.log(`\nUsage: ${cyan('basicben registry <command> [options]')}`)
  console.log(`\nCommands:`)
  console.log(`  ${bold('list')}                  List configured registries`)
  console.log(`  ${bold('add')} <url>             Add a registry`)
  console.log(`  ${bold('remove')} <url>          Remove a registry`)
  console.log(`  ${bold('ping')} [url]            Test registry connection(s)`)
  console.log(`\nOptions:`)
  console.log(`  ${bold('--force')}               Force action (skip checks)`)
  console.log(`  ${bold('--json')}                Output as JSON\n`)
}
