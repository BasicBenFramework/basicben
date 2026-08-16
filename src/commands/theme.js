/**
 * CLI command: basicben theme
 *
 * Manage themes - install, update, remove, list, activate.
 *
 * Usage:
 *   basicben theme list              List installed themes
 *   basicben theme search <query>    Search theme registry
 *   basicben theme install <slug>    Install a theme
 *   basicben theme update <slug>     Update a theme
 *   basicben theme remove <slug>     Remove a theme
 *   basicben theme activate <slug>   Activate a theme
 */

import { bold, green, yellow, red, cyan, dim, gray } from '../cli/colors.js'
import { UpdateManager } from '../updates/index.js'
import { canInstallThemes } from '../server/environment.js'

export async function run(args, flags) {
  const subcommand = args[0] || 'list'
  const updates = new UpdateManager()

  switch (subcommand) {
    case 'list':
    case 'ls':
      await listThemes(updates, flags)
      break

    case 'search':
      await searchThemes(updates, args.slice(1), flags)
      break

    case 'install':
    case 'add':
      await installTheme(updates, args.slice(1), flags)
      break

    case 'update':
    case 'upgrade':
      await updateTheme(updates, args.slice(1), flags)
      break

    case 'remove':
    case 'uninstall':
    case 'rm':
      await removeTheme(updates, args.slice(1), flags)
      break

    case 'activate':
    case 'use':
      await activateTheme(args.slice(1), flags)
      break

    default:
      console.error(`\n${red('Error:')} Unknown subcommand: ${bold(subcommand)}`)
      showHelp()
      process.exit(1)
  }
}

/**
 * List installed themes
 */
async function listThemes(updates, flags) {
  console.log(`\n${bold('Installed Themes')}\n`)

  try {
    const installed = await updates.getInstalledThemes()

    if (installed.length === 0) {
      console.log(`${dim('No themes installed.')}\n`)
      console.log(`Run ${cyan('basicben theme search <query>')} to find themes.`)
      console.log(`Run ${cyan('basicben theme install <slug>')} to install one.\n`)
      return
    }

    // Get active theme
    let activeTheme = null
    try {
      const { themes } = await import('../themes/index.js')
      activeTheme = themes.getActive()?.slug
    } catch {
      // Themes not initialized
    }

    // Check for updates
    const available = await updates.checkThemeUpdates()
    const updateMap = new Map(available.map(t => [t.slug, t.latestVersion]))

    // Table header
    console.log(`${dim('┌' + '─'.repeat(65) + '┐')}`)
    console.log(`${dim('│')} ${bold('Theme'.padEnd(20))} ${bold('Version'.padEnd(12))} ${bold('Update'.padEnd(12))} ${bold('Status'.padEnd(10))} ${dim('│')}`)
    console.log(`${dim('├' + '─'.repeat(65) + '┤')}`)

    for (const theme of installed) {
      const update = updateMap.get(theme.slug)
      const updateCol = update ? green(update) : dim('—')
      const status = theme.slug === activeTheme ? green('Active') : dim('—')
      console.log(`${dim('│')} ${theme.name.padEnd(20)} ${dim(theme.version.padEnd(12))} ${updateCol.padEnd(12)} ${status.padEnd(10)} ${dim('│')}`)
    }

    console.log(`${dim('└' + '─'.repeat(65) + '┘')}`)

    if (available.length > 0) {
      console.log(`\n${yellow('!')} ${available.length} update(s) available.`)
    }

    console.log('')

    if (flags.json) {
      console.log(JSON.stringify(installed, null, 2))
    }
  } catch (error) {
    console.error(`${red('Error:')} ${error.message}\n`)
    process.exit(1)
  }
}

/**
 * Search theme registry
 */
async function searchThemes(updates, args, flags) {
  const query = args.join(' ')

  if (!query && !flags.category) {
    console.error(`\n${red('Error:')} Please provide a search query.`)
    console.error(`\nUsage: ${cyan('basicben theme search <query>')}\n`)
    process.exit(1)
  }

  console.log(`\n${bold('Searching themes...')}\n`)

  try {
    const results = await updates.registry.searchThemes({
      search: query,
      category: flags.category,
      page: flags.page || 1,
      limit: flags.limit || 10
    })

    if (results.themes.length === 0) {
      console.log(`${dim('No themes found.')}\n`)
      return
    }

    console.log(`Found ${bold(results.total)} theme(s):\n`)

    for (const theme of results.themes) {
      const premium = theme.premium ? yellow(' [PRO]') : ''

      console.log(`  ${bold(theme.name)}${premium}`)
      console.log(`  ${dim(theme.slug)} · v${theme.version}`)
      console.log(`  ${theme.description || dim('No description')}`)
      console.log(`  ${cyan(`basicben theme install ${theme.slug}`)}\n`)
    }

    if (flags.json) {
      console.log(JSON.stringify(results, null, 2))
    }
  } catch (error) {
    console.error(`${red('Error:')} ${error.message}\n`)
    process.exit(1)
  }
}

/**
 * Install a theme
 */
async function installTheme(updates, args, flags) {
  const input = args[0]

  if (!input) {
    console.error(`\n${red('Error:')} Please specify a theme to install.`)
    console.error(`\nUsage: ${cyan('basicben theme install <slug>')}\n`)
    process.exit(1)
  }

  if (!canInstallThemes()) {
    console.error(`\n${red('Error:')} Theme installation is not available on your plan.`)
    console.error(`${dim('Upgrade to Pro or Business to install custom themes.')}\n`)
    process.exit(1)
  }

  // Parse slug@version format
  const [slug, version] = input.split('@')

  console.log(`\n${bold('Installing theme:')} ${cyan(slug)}${version ? `@${version}` : ''}\n`)

  try {
    const result = await updates.installTheme(slug, {
      version: version || 'latest',
      onProgress: ({ step, message }) => {
        console.log(`  ${message}`)
      }
    })

    console.log(`\n${green('✓')} ${bold('Theme installed successfully!')}`)
    console.log(`  Name: ${result.slug}`)
    console.log(`  Version: ${result.version}`)
    console.log(`  Path: ${dim(result.path)}`)
    console.log(`\n  Run ${cyan(`basicben theme activate ${result.slug}`)} to use it.\n`)

  } catch (error) {
    console.error(`\n${red('✗')} ${bold('Installation failed')}`)
    console.error(`  ${error.message}\n`)
    process.exit(1)
  }
}

/**
 * Update a theme
 */
async function updateTheme(updates, args, flags) {
  if (flags.all) {
    await updateAllThemes(updates, flags)
    return
  }

  const slug = args[0]

  if (!slug) {
    console.error(`\n${red('Error:')} Please specify a theme to update or use --all.`)
    console.error(`\nUsage:`)
    console.error(`  ${cyan('basicben theme update <slug>')}`)
    console.error(`  ${cyan('basicben theme update --all')}\n`)
    process.exit(1)
  }

  console.log(`\n${bold('Updating theme:')} ${cyan(slug)}\n`)

  try {
    const result = await updates.updateTheme(slug, {
      onProgress: ({ step, message }) => {
        console.log(`  ${message}`)
      }
    })

    if (result.message) {
      console.log(`\n${green('✓')} ${result.message}\n`)
    } else {
      console.log(`\n${green('✓')} ${bold('Theme updated!')}`)
      console.log(`  Version: ${result.version}\n`)
    }
  } catch (error) {
    console.error(`\n${red('✗')} ${bold('Update failed')}`)
    console.error(`  ${error.message}\n`)
    process.exit(1)
  }
}

/**
 * Update all themes
 */
async function updateAllThemes(updates, flags) {
  console.log(`\n${bold('Checking for theme updates...')}\n`)

  try {
    const available = await updates.checkThemeUpdates()

    if (available.length === 0) {
      console.log(`${green('✓')} All themes are up to date.\n`)
      return
    }

    console.log(`Found ${bold(available.length)} update(s):\n`)

    for (const theme of available) {
      console.log(`  ${theme.name}: ${dim(theme.currentVersion)} → ${green(theme.latestVersion)}`)
    }

    console.log('')

    // Update each theme
    let success = 0
    let failed = 0

    for (const theme of available) {
      process.stdout.write(`  Updating ${theme.slug}...`)
      try {
        await updates.updateTheme(theme.slug)
        console.log(` ${green('✓')}`)
        success++
      } catch (error) {
        console.log(` ${red('✗')} ${dim(error.message)}`)
        failed++
      }
    }

    console.log(`\n${green('✓')} Updated ${success} theme(s)`)
    if (failed > 0) {
      console.log(`${red('✗')} Failed to update ${failed} theme(s)`)
    }
    console.log('')

  } catch (error) {
    console.error(`${red('Error:')} ${error.message}\n`)
    process.exit(1)
  }
}

/**
 * Remove a theme
 */
async function removeTheme(updates, args, flags) {
  const slug = args[0]

  if (!slug) {
    console.error(`\n${red('Error:')} Please specify a theme to remove.`)
    console.error(`\nUsage: ${cyan('basicben theme remove <slug>')}\n`)
    process.exit(1)
  }

  // Check if it's the active theme
  try {
    const { themes } = await import('../themes/index.js')
    const active = themes.getActive()
    if (active?.slug === slug) {
      console.error(`\n${red('Error:')} Cannot remove the active theme.`)
      console.error(`${dim('Please activate a different theme first.')}\n`)
      process.exit(1)
    }
  } catch {
    // Themes not initialized
  }

  if (!flags.yes && !flags.y) {
    const readline = await import('node:readline')
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })

    const answer = await new Promise(resolve => {
      rl.question(`${yellow('?')} Remove theme ${bold(slug)}? (y/N) `, resolve)
    })
    rl.close()

    if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
      console.log(`\n${dim('Cancelled.')}\n`)
      return
    }
  }

  console.log(`\n${bold('Removing theme:')} ${cyan(slug)}\n`)

  try {
    await updates.removeTheme(slug)
    console.log(`${green('✓')} Theme removed.\n`)
  } catch (error) {
    console.error(`${red('✗')} ${error.message}\n`)
    process.exit(1)
  }
}

/**
 * Activate a theme
 */
async function activateTheme(args, flags) {
  const slug = args[0]

  if (!slug) {
    console.error(`\n${red('Error:')} Please specify a theme to activate.`)
    console.error(`\nUsage: ${cyan('basicben theme activate <slug>')}\n`)
    process.exit(1)
  }

  console.log(`\n${dim('Activating theme...')}\n`)

  try {
    const { themes } = await import('../themes/index.js')
    const { loadThemes } = await import('../themes/loader.js')

    // Themes have to be read off disk first. This process is not the server,
    // so the manager starts empty — without this, activate() reported "not
    // registered" and returned false while the command below still printed a
    // tick.
    await loadThemes('themes')

    if (!themes.themes.has(slug)) {
      const installed = [...themes.themes.keys()]
      console.error(`${red('✗')} Theme ${bold(slug)} is not installed.\n`)
      console.error(
        installed.length
          ? `${dim('Installed:')} ${installed.join(', ')}\n`
          : `${dim('No themes found in themes/.')}\n`
      )
      process.exit(1)
    }

    if (!(await themes.activate(slug))) {
      console.error(`${red('✗')} Theme ${bold(slug)} could not be activated.\n`)
      process.exit(1)
    }

    // activate() only moves the manager's own pointer, which dies with this
    // process. The server reads `active_theme` from settings at boot, so the
    // choice has to be written there to outlive the command.
    await persistActiveTheme(slug)

    console.log(`${green('✓')} Theme ${bold(slug)} activated.\n`)
    console.log(`${dim('Restart the server for it to take effect.')}\n`)
  } catch (error) {
    console.error(`${red('✗')} ${error.message}\n`)
    process.exit(1)
  }
}

/**
 * Store the active theme where the server looks for it at boot.
 *
 * @param {string} slug
 */
async function persistActiveTheme(slug) {
  const { getDb } = await import('../db/index.js')
  const db = await getDb()

  const existing = await db.get('SELECT key FROM settings WHERE key = ?', ['active_theme'])

  if (existing) {
    await db.run(
      "UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?",
      [slug, 'active_theme']
    )
  } else {
    await db.run(
      "INSERT INTO settings (key, value, group_name) VALUES (?, ?, 'appearance')",
      ['active_theme', slug]
    )
  }
}

/**
 * Show help
 */
function showHelp() {
  console.log(`\nUsage: ${cyan('basicben theme <command> [options]')}`)
  console.log(`\nCommands:`)
  console.log(`  ${bold('list')}                  List installed themes`)
  console.log(`  ${bold('search')} <query>        Search theme registry`)
  console.log(`  ${bold('install')} <slug>        Install a theme`)
  console.log(`  ${bold('update')} <slug>         Update a theme`)
  console.log(`  ${bold('update')} --all          Update all themes`)
  console.log(`  ${bold('remove')} <slug>         Remove a theme`)
  console.log(`  ${bold('activate')} <slug>       Activate a theme`)
  console.log(`\nOptions:`)
  console.log(`  ${bold('--json')}                Output as JSON`)
  console.log(`  ${bold('-y, --yes')}             Skip confirmation prompts\n`)
}
