/**
 * CLI command: basicben updates
 *
 * Check for and apply updates to core and plugins.
 *
 * Usage:
 *   basicben updates check        Check for available updates
 *   basicben updates apply        Apply core update
 *   basicben updates changelog    View changelog for latest version
 */

import { bold, green, yellow, red, cyan, dim, gray } from '../cli/colors.js'
import { UpdateManager } from '../updates/index.js'
import { isCloud, canManualUpdate } from '../server/environment.js'

export async function run(args, flags) {
  const subcommand = args[0] || 'check'

  // Check if running in cloud mode
  if (isCloud() && subcommand === 'apply') {
    console.error(`\n${red('Error:')} Updates are managed automatically on BasicBen Cloud.`)
    console.error(`${dim('Your instance will be updated automatically when new versions are released.')}\n`)
    process.exit(1)
  }

  const updates = new UpdateManager()

  switch (subcommand) {
    case 'check':
      await checkUpdates(updates, flags)
      break

    case 'apply':
      await applyUpdate(updates, args.slice(1), flags)
      break

    case 'changelog':
      await showChangelog(updates, args[1], flags)
      break

    default:
      console.error(`\n${red('Error:')} Unknown subcommand: ${bold(subcommand)}`)
      console.error(`\nUsage:`)
      console.error(`  ${cyan('basicben updates check')}      Check for available updates`)
      console.error(`  ${cyan('basicben updates apply')}      Apply core update`)
      console.error(`  ${cyan('basicben updates changelog')} View changelog\n`)
      process.exit(1)
  }
}

/**
 * Check for available updates
 */
async function checkUpdates(updates, flags) {
  console.log(`\n${bold('Checking for updates...')}\n`)

  try {
    const result = await updates.checkAll(true)

    // Core update
    if (result.core?.available) {
      console.log(boxed([
        `${yellow('⬆')}  ${bold('Core Update Available')}`,
        '',
        `   Current: ${dim(result.core.current)}`,
        `   Latest:  ${green(result.core.latest)}`,
        `   Channel: ${result.core.channel}`,
        '',
        `   Run ${cyan('basicben updates apply')} to update`
      ]))
    } else if (result.core && !result.core.error) {
      console.log(`${green('✓')} Core: ${result.core.current} ${dim('(up to date)')}`)
    } else if (result.core?.error) {
      console.log(`${yellow('!')} Core: ${dim('Could not check')} ${dim(`(${result.core.error})`)}`)
    }

    // Plugin updates
    if (result.plugins?.length > 0) {
      console.log(`\n${yellow('⬆')}  ${bold(`${result.plugins.length} plugin update(s) available:`)}`)
      for (const plugin of result.plugins) {
        console.log(`   ${plugin.name}: ${dim(plugin.currentVersion)} → ${green(plugin.latestVersion)}`)
      }
      console.log(`\n   Run ${cyan('basicben plugin update --all')} to update all`)
    } else {
      console.log(`${green('✓')} Plugins: ${dim('All up to date')}`)
    }

    // Output JSON if requested
    if (flags.json) {
      console.log('\n' + JSON.stringify(result, null, 2))
    }

    console.log('')
  } catch (error) {
    console.error(`\n${red('Error:')} Failed to check for updates`)
    console.error(`${dim(error.message)}\n`)
    process.exit(1)
  }
}

/**
 * Apply core update
 */
async function applyUpdate(updates, args, flags) {
  if (!canManualUpdate()) {
    console.error(`\n${red('Error:')} Updates are disabled.`)
    if (isCloud()) {
      console.error(`${dim('Cloud instances are updated automatically.')}\n`)
    }
    process.exit(1)
  }

  const version = args[0] || 'latest'

  console.log(`\n${bold('Checking for updates...')}\n`)

  // Check for update first
  const check = await updates.checkCoreUpdate()

  if (!check?.available && version === 'latest') {
    console.log(`${green('✓')} Already at the latest version (${check?.current})\n`)
    return
  }

  const targetVersion = version === 'latest' ? check.latest : version

  console.log(`${bold('Updating BasicBen')} ${dim(check.current)} → ${green(targetVersion)}\n`)

  if (!flags.yes && !flags.y) {
    // Confirm update
    const readline = await import('node:readline')
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })

    const answer = await new Promise(resolve => {
      rl.question(`${yellow('?')} Continue with update? (y/N) `, resolve)
    })
    rl.close()

    if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
      console.log(`\n${dim('Update cancelled.')}\n`)
      return
    }
    console.log('')
  }

  try {
    const result = await updates.updateCore(targetVersion, {
      skipBackup: flags['no-backup'],
      onProgress: ({ step, message }) => {
        const icons = {
          backup: '📦',
          package: '📝',
          install: '📥',
          migrations: '🔄',
          cache: '🧹',
          complete: '✅',
          error: '❌'
        }
        console.log(`${icons[step] || '•'} ${message}`)
      }
    })

    console.log(`\n${green('✓')} ${bold('Update complete!')}`)
    console.log(`  Version: ${green(result.version)}`)
    console.log(`  Previous: ${dim(result.previousVersion)}\n`)

  } catch (error) {
    console.error(`\n${red('✗')} ${bold('Update failed')}`)
    console.error(`  ${error.message}\n`)
    process.exit(1)
  }
}

/**
 * Show changelog for a version
 */
async function showChangelog(updates, version, flags) {
  const targetVersion = version || 'latest'

  console.log(`\n${bold('Fetching changelog...')}\n`)

  try {
    let changelog

    if (targetVersion === 'latest') {
      const core = await updates.checkCoreUpdate()
      changelog = core?.changelog
    } else {
      changelog = await updates.registry.getCoreChangelog(targetVersion)
    }

    if (changelog) {
      console.log(changelog)
    } else {
      console.log(`${dim('No changelog available.')}\n`)
    }
  } catch (error) {
    console.error(`${red('Error:')} Could not fetch changelog`)
    console.error(`${dim(error.message)}\n`)
    process.exit(1)
  }
}

/**
 * Helper: Create a box around content
 */
function boxed(lines) {
  const maxLen = Math.max(...lines.map(l => stripAnsi(l).length))
  const top = '┌' + '─'.repeat(maxLen + 2) + '┐'
  const bottom = '└' + '─'.repeat(maxLen + 2) + '┘'
  const middle = lines.map(l => {
    const padding = ' '.repeat(maxLen - stripAnsi(l).length)
    return `│ ${l}${padding} │`
  })
  return [top, ...middle, bottom].join('\n')
}

/**
 * Strip ANSI codes for length calculation
 */
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}
