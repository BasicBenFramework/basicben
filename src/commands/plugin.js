/**
 * CLI command: basicben plugin
 *
 * Manage plugins - install, update, remove, list.
 *
 * Usage:
 *   basicben plugin list                 List installed plugins
 *   basicben plugin search <query>       Search plugin registry
 *   basicben plugin install <slug>       Install a plugin
 *   basicben plugin update <slug>        Update a plugin
 *   basicben plugin update --all         Update all plugins
 *   basicben plugin remove <slug>        Remove a plugin
 *   basicben plugin activate <slug>      Activate a plugin
 *   basicben plugin deactivate <slug>    Deactivate a plugin
 */

import { bold, green, yellow, red, cyan, dim, gray } from '../cli/colors.js'
import { UpdateManager } from '../updates/index.js'
import { canInstallPlugins } from '../server/environment.js'

export async function run(args, flags) {
  const subcommand = args[0] || 'list'
  const updates = new UpdateManager()

  switch (subcommand) {
    case 'list':
    case 'ls':
      await listPlugins(updates, flags)
      break

    case 'search':
      await searchPlugins(updates, args.slice(1), flags)
      break

    case 'install':
    case 'add':
      await installPlugin(updates, args.slice(1), flags)
      break

    case 'update':
    case 'upgrade':
      await updatePlugin(updates, args.slice(1), flags)
      break

    case 'remove':
    case 'uninstall':
    case 'rm':
      await removePlugin(updates, args.slice(1), flags)
      break

    case 'activate':
    case 'enable':
      await activatePlugin(args.slice(1), flags)
      break

    case 'deactivate':
    case 'disable':
      await deactivatePlugin(args.slice(1), flags)
      break

    default:
      console.error(`\n${red('Error:')} Unknown subcommand: ${bold(subcommand)}`)
      showHelp()
      process.exit(1)
  }
}

/**
 * List installed plugins
 */
async function listPlugins(updates, flags) {
  console.log(`\n${bold('Installed Plugins')}\n`)

  try {
    const installed = await updates.getInstalledPlugins()

    if (installed.length === 0) {
      console.log(`${dim('No plugins installed.')}\n`)
      console.log(`Run ${cyan('basicben plugin search <query>')} to find plugins.`)
      console.log(`Run ${cyan('basicben plugin install <slug>')} to install one.\n`)
      return
    }

    // Check for updates
    const available = await updates.checkPluginUpdates()
    const updateMap = new Map(available.map(p => [p.slug, p.latestVersion]))

    // Table header
    console.log(`${dim('┌' + '─'.repeat(60) + '┐')}`)
    console.log(`${dim('│')} ${bold('Plugin'.padEnd(20))} ${bold('Version'.padEnd(12))} ${bold('Update'.padEnd(12))} ${dim('│')}`)
    console.log(`${dim('├' + '─'.repeat(60) + '┤')}`)

    for (const plugin of installed) {
      const update = updateMap.get(plugin.slug)
      const updateCol = update ? green(update) : dim('—')
      console.log(`${dim('│')} ${plugin.name.padEnd(20)} ${dim(plugin.version.padEnd(12))} ${updateCol.padEnd(12)} ${dim('│')}`)
    }

    console.log(`${dim('└' + '─'.repeat(60) + '┘')}`)

    if (available.length > 0) {
      console.log(`\n${yellow('!')} ${available.length} update(s) available. Run ${cyan('basicben plugin update --all')} to update.`)
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
 * Search plugin registry
 */
async function searchPlugins(updates, args, flags) {
  const query = args.join(' ')

  if (!query && !flags.category) {
    console.error(`\n${red('Error:')} Please provide a search query.`)
    console.error(`\nUsage: ${cyan('basicben plugin search <query>')}\n`)
    process.exit(1)
  }

  console.log(`\n${bold('Searching plugins...')}\n`)

  try {
    const results = await updates.registry.searchPlugins({
      search: query,
      category: flags.category,
      page: flags.page || 1,
      limit: flags.limit || 10
    })

    if (results.plugins.length === 0) {
      console.log(`${dim('No plugins found.')}\n`)
      return
    }

    console.log(`Found ${bold(results.total)} plugin(s):\n`)

    for (const plugin of results.plugins) {
      const stars = '★'.repeat(Math.round(plugin.rating || 0)) + '☆'.repeat(5 - Math.round(plugin.rating || 0))
      const premium = plugin.premium ? yellow(' [PRO]') : ''

      console.log(`  ${bold(plugin.name)}${premium}`)
      console.log(`  ${dim(plugin.slug)} · v${plugin.version} · ${gray(stars)}`)
      console.log(`  ${plugin.description || dim('No description')}`)
      console.log(`  ${cyan(`basicben plugin install ${plugin.slug}`)}\n`)
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
 * Install a plugin
 */
async function installPlugin(updates, args, flags) {
  const input = args[0]

  if (!input) {
    console.error(`\n${red('Error:')} Please specify a plugin to install.`)
    console.error(`\nUsage: ${cyan('basicben plugin install <slug>')}\n`)
    process.exit(1)
  }

  if (!canInstallPlugins()) {
    console.error(`\n${red('Error:')} Plugin installation is not available on your plan.`)
    console.error(`${dim('Upgrade to Pro or Business to install custom plugins.')}\n`)
    process.exit(1)
  }

  // Parse slug@version format
  const [slug, version] = input.split('@')

  console.log(`\n${bold('Installing plugin:')} ${cyan(slug)}${version ? `@${version}` : ''}\n`)

  try {
    const result = await updates.installPlugin(slug, {
      version: version || 'latest',
      registry: flags.registry,
      onProgress: ({ step, message, progress }) => {
        if (step === 'download' && progress !== undefined) {
          const percent = Math.round(progress * 100)
          process.stdout.write(`\r  Downloading... ${percent}%`)
          if (progress >= 1) console.log('')
        } else {
          console.log(`  ${message}`)
        }
      }
    })

    console.log(`\n${green('✓')} ${bold('Plugin installed successfully!')}`)
    console.log(`  Name: ${result.slug}`)
    console.log(`  Version: ${result.version}`)
    console.log(`  Path: ${dim(result.path)}\n`)

  } catch (error) {
    console.error(`\n${red('✗')} ${bold('Installation failed')}`)
    console.error(`  ${error.message}\n`)
    process.exit(1)
  }
}

/**
 * Update a plugin
 */
async function updatePlugin(updates, args, flags) {
  if (flags.all) {
    await updateAllPlugins(updates, flags)
    return
  }

  const slug = args[0]

  if (!slug) {
    console.error(`\n${red('Error:')} Please specify a plugin to update or use --all.`)
    console.error(`\nUsage:`)
    console.error(`  ${cyan('basicben plugin update <slug>')}`)
    console.error(`  ${cyan('basicben plugin update --all')}\n`)
    process.exit(1)
  }

  console.log(`\n${bold('Updating plugin:')} ${cyan(slug)}\n`)

  try {
    const result = await updates.updatePlugin(slug, {
      onProgress: ({ step, message }) => {
        console.log(`  ${message}`)
      }
    })

    if (result.message) {
      console.log(`\n${green('✓')} ${result.message}\n`)
    } else {
      console.log(`\n${green('✓')} ${bold('Plugin updated!')}`)
      console.log(`  Version: ${result.version}\n`)
    }
  } catch (error) {
    console.error(`\n${red('✗')} ${bold('Update failed')}`)
    console.error(`  ${error.message}\n`)
    process.exit(1)
  }
}

/**
 * Update all plugins
 */
async function updateAllPlugins(updates, flags) {
  console.log(`\n${bold('Checking for plugin updates...')}\n`)

  try {
    const available = await updates.checkPluginUpdates()

    if (available.length === 0) {
      console.log(`${green('✓')} All plugins are up to date.\n`)
      return
    }

    console.log(`Found ${bold(available.length)} update(s):\n`)

    for (const plugin of available) {
      console.log(`  ${plugin.name}: ${dim(plugin.currentVersion)} → ${green(plugin.latestVersion)}`)
    }

    console.log('')

    // Update each plugin
    let success = 0
    let failed = 0

    for (const plugin of available) {
      process.stdout.write(`  Updating ${plugin.slug}...`)
      try {
        await updates.updatePlugin(plugin.slug)
        console.log(` ${green('✓')}`)
        success++
      } catch (error) {
        console.log(` ${red('✗')} ${dim(error.message)}`)
        failed++
      }
    }

    console.log(`\n${green('✓')} Updated ${success} plugin(s)`)
    if (failed > 0) {
      console.log(`${red('✗')} Failed to update ${failed} plugin(s)`)
    }
    console.log('')

  } catch (error) {
    console.error(`${red('Error:')} ${error.message}\n`)
    process.exit(1)
  }
}

/**
 * Remove a plugin
 */
async function removePlugin(updates, args, flags) {
  const slug = args[0]

  if (!slug) {
    console.error(`\n${red('Error:')} Please specify a plugin to remove.`)
    console.error(`\nUsage: ${cyan('basicben plugin remove <slug>')}\n`)
    process.exit(1)
  }

  if (!flags.yes && !flags.y) {
    const readline = await import('node:readline')
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })

    const answer = await new Promise(resolve => {
      rl.question(`${yellow('?')} Remove plugin ${bold(slug)}? (y/N) `, resolve)
    })
    rl.close()

    if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
      console.log(`\n${dim('Cancelled.')}\n`)
      return
    }
  }

  console.log(`\n${bold('Removing plugin:')} ${cyan(slug)}\n`)

  try {
    await updates.removePlugin(slug)
    console.log(`${green('✓')} Plugin removed.\n`)
  } catch (error) {
    console.error(`${red('✗')} ${error.message}\n`)
    process.exit(1)
  }
}

/**
 * Activate a plugin
 */
async function activatePlugin(args, flags) {
  const slug = args[0]

  if (!slug) {
    console.error(`\n${red('Error:')} Please specify a plugin to activate.`)
    console.error(`\nUsage: ${cyan('basicben plugin activate <slug>')}\n`)
    process.exit(1)
  }

  console.log(`\n${dim('Activating plugin...')}\n`)

  try {
    // The CLI runs in a fresh process where nothing has been loaded yet, so the
    // plugin has to be discovered before it can be activated. Without this,
    // activate() was always called against an empty registry — it failed, and
    // the tick below printed anyway because nothing checked.
    const { loadPlugins } = await import('../plugins/loader.js')
    const { plugins } = await import('../plugins/index.js')

    await loadPlugins('plugins', { context: {} })
    await plugins.activate(slug)

    // Persist it, or the choice is forgotten the moment this process exits.
    // The server reads this list at boot; the admin UI writes the same key.
    await persistEnabled(slug, true)

    console.log(`${green('✓')} Plugin ${bold(slug)} activated.`)
    console.log(`${dim('  Restart the server for its hooks and routes to take effect.')}\n`)
  } catch (error) {
    console.error(`${red('✗')} ${error.message}\n`)
    process.exit(1)
  }
}

/**
 * Add or remove a plugin from the enabled list the server reads at boot.
 *
 * Silently does nothing when there is no database — activation still worked for
 * this process, and a project without one is configured through
 * `enabledPlugins` in basicben.config.js instead.
 */
async function persistEnabled(slug, enabled) {
  try {
    const { getDb } = await import('../db/index.js')
    const { saveEnabledPlugins } = await import('../plugins/loader.js')
    const db = await getDb()

    const row = await db.get('SELECT value FROM settings WHERE key = ?', ['enabled_plugins'])
    const current = row?.value ? JSON.parse(row.value) : []

    const next = enabled
      ? [...new Set([...current, slug])]
      : current.filter((name) => name !== slug)

    await saveEnabledPlugins(db, next)
  } catch {
    console.log(`${dim('  (no database — add it to enabledPlugins in basicben.config.js to persist)')}`)
  }
}

/**
 * Deactivate a plugin
 */
async function deactivatePlugin(args, flags) {
  const slug = args[0]

  if (!slug) {
    console.error(`\n${red('Error:')} Please specify a plugin to deactivate.`)
    console.error(`\nUsage: ${cyan('basicben plugin deactivate <slug>')}\n`)
    process.exit(1)
  }

  console.log(`\n${dim('Deactivating plugin...')}\n`)

  try {
    // What matters here is the stored list, not this process. The plugin is not
    // running in the CLI, so "deactivating" it means taking it off the list the
    // server activates from at boot.
    await persistEnabled(slug, false)

    console.log(`${green('✓')} Plugin ${bold(slug)} deactivated.`)
    console.log(`${dim('  Restart the server to unload it.')}\n`)
  } catch (error) {
    console.error(`${red('✗')} ${error.message}\n`)
    process.exit(1)
  }
}

/**
 * Show help
 */
function showHelp() {
  console.log(`\nUsage: ${cyan('basicben plugin <command> [options]')}`)
  console.log(`\nCommands:`)
  console.log(`  ${bold('list')}                    List installed plugins`)
  console.log(`  ${bold('search')} <query>          Search plugin registry`)
  console.log(`  ${bold('install')} <slug>          Install a plugin`)
  console.log(`  ${bold('update')} <slug>           Update a plugin`)
  console.log(`  ${bold('update')} --all            Update all plugins`)
  console.log(`  ${bold('remove')} <slug>           Remove a plugin`)
  console.log(`  ${bold('activate')} <slug>         Activate a plugin`)
  console.log(`  ${bold('deactivate')} <slug>       Deactivate a plugin`)
  console.log(`\nOptions:`)
  console.log(`  ${bold('--registry')} <url>        Use specific registry`)
  console.log(`  ${bold('--json')}                  Output as JSON`)
  console.log(`  ${bold('-y, --yes')}               Skip confirmation prompts\n`)
}
