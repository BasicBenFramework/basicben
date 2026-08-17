/**
 * CLI command: basicben plugin
 *
 * Inspect and toggle the plugins this project ships.
 *
 * There is deliberately no `install`. A plugin is source in your repository —
 * either a file under `plugins/` or an object you import and pass to
 * `createServer` — so it arrives the way the rest of your code does, through git
 * and your package manager. Downloading one into a running server was the
 * WordPress model, and it does not survive a redeploy on any host that rebuilds
 * from an image.
 *
 * Usage:
 *   basicben plugin list                 List plugins and their status
 *   basicben plugin activate <name>      Activate a plugin
 *   basicben plugin deactivate <name>    Deactivate a plugin
 */

import { bold, green, red, cyan, dim, gray } from '../cli/colors.js'

export async function run(args, flags) {
  const subcommand = args[0] || 'list'

  switch (subcommand) {
    case 'list':
    case 'ls':
      await listPlugins(flags)
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
 * List plugins found in the plugins directory.
 *
 * Plugins registered by passing objects to `createServer` are not listed: they
 * exist only inside the server process, and this command runs in its own.
 */
async function listPlugins(flags) {
  try {
    const { loadPlugins } = await import('../plugins/loader.js')
    const { plugins } = await import('../plugins/index.js')

    await loadPlugins('plugins', { context: {} })

    const enabled = await readEnabled()
    const installed = plugins.list().map((plugin) => ({
      ...plugin,
      active: enabled.includes(plugin.name)
    }))

    if (flags.json) {
      console.log(JSON.stringify(installed, null, 2))
      return
    }

    if (installed.length === 0) {
      console.log(`\n${dim('No plugins found in plugins/.')}\n`)
      console.log(`Add a ${cyan('plugins/my-plugin.js')} exporting a plugin object,`)
      console.log(`or import one and pass it to ${cyan('createServer({ plugins: [...] })')}.\n`)
      return
    }

    console.log(`\n${bold('Plugins')} ${gray(`(${installed.length})`)}\n`)

    for (const plugin of installed) {
      const status = plugin.active ? green('active') : gray('inactive')

      console.log(`  ${bold(plugin.name)} ${gray(`v${plugin.version}`)}  ${status}`)

      if (plugin.description) {
        console.log(`    ${dim(plugin.description)}`)
      }
    }

    console.log()
  } catch (error) {
    console.error(`\n${red('✗')} ${error.message}\n`)
    process.exit(1)
  }
}

/**
 * Activate a plugin
 */
async function activatePlugin(args, flags) {
  const name = args[0]

  if (!name) {
    console.error(`\n${red('Error:')} Please specify a plugin to activate.`)
    console.error(`\nUsage: ${cyan('basicben plugin activate <name>')}\n`)
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
    await plugins.activate(name)

    // Persist it, or the choice is forgotten the moment this process exits.
    // The server reads this list at boot; the admin UI writes the same key.
    await persistEnabled(name, true)

    console.log(`${green('✓')} Plugin ${bold(name)} activated.`)
    console.log(`${dim('  Restart the server for its hooks and routes to take effect.')}\n`)
  } catch (error) {
    console.error(`${red('✗')} ${error.message}\n`)
    process.exit(1)
  }
}

/**
 * Deactivate a plugin
 */
async function deactivatePlugin(args, flags) {
  const name = args[0]

  if (!name) {
    console.error(`\n${red('Error:')} Please specify a plugin to deactivate.`)
    console.error(`\nUsage: ${cyan('basicben plugin deactivate <name>')}\n`)
    process.exit(1)
  }

  console.log(`\n${dim('Deactivating plugin...')}\n`)

  try {
    // What matters here is the stored list, not this process. The plugin is not
    // running in the CLI, so "deactivating" it means taking it off the list the
    // server activates from at boot.
    await persistEnabled(name, false)

    console.log(`${green('✓')} Plugin ${bold(name)} deactivated.`)
    console.log(`${dim('  Restart the server to unload it.')}\n`)
  } catch (error) {
    console.error(`${red('✗')} ${error.message}\n`)
    process.exit(1)
  }
}

/**
 * The enabled list the server activates from at boot.
 *
 * Returns an empty list when there is no database rather than failing: a
 * project can pin its plugins through `enabledPlugins` in basicben.config.js
 * instead, and `list` should still show what is there.
 *
 * @returns {Promise<string[]>}
 */
async function readEnabled() {
  try {
    const { getDb } = await import('../db/index.js')
    const db = await getDb()
    const row = await db.get('SELECT value FROM settings WHERE key = ?', ['enabled_plugins'])

    return row?.value ? JSON.parse(row.value) : []
  } catch {
    return []
  }
}

/**
 * Add or remove a plugin from the enabled list the server reads at boot.
 *
 * Silently does nothing when there is no database — activation still worked for
 * this process, and a project without one is configured through
 * `enabledPlugins` in basicben.config.js instead.
 */
async function persistEnabled(name, enabled) {
  try {
    const { getDb } = await import('../db/index.js')
    const { saveEnabledPlugins } = await import('../plugins/loader.js')
    const db = await getDb()

    const current = await readEnabled()

    const next = enabled
      ? [...new Set([...current, name])]
      : current.filter((plugin) => plugin !== name)

    await saveEnabledPlugins(db, next)
  } catch {
    console.log(`${dim('  (no database — add it to enabledPlugins in basicben.config.js to persist)')}`)
  }
}

/**
 * Show help
 */
function showHelp() {
  console.log(`\nUsage: ${cyan('basicben plugin <command> [options]')}`)
  console.log(`\nCommands:`)
  console.log(`  ${bold('list')}                    List plugins and whether each is active`)
  console.log(`  ${bold('activate')} <name>         Activate a plugin`)
  console.log(`  ${bold('deactivate')} <name>       Deactivate a plugin`)
  console.log(`\nOptions:`)
  console.log(`  ${bold('--json')}                  Output as JSON\n`)
}
