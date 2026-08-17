import { Settings } from '../models/Settings'
import type { Request, Response } from '../types'

interface PluginInfo {
  name: string
  version: string
  description?: string
  author?: string
  active: boolean
  /** Where the plugin came from: a file in plugins/, or the server config. */
  source: 'directory' | 'config'
  settings?: Record<string, unknown>
}

export const PluginController = {
  async index(req: Request, res: Response) {
    const plugins = await getInstalledPlugins()
    const enabledPlugins = await Settings.getEnabledPlugins()

    const pluginsWithStatus = plugins.map(plugin => ({
      ...plugin,
      active: enabledPlugins.includes(plugin.name)
    }))

    res.json({ plugins: pluginsWithStatus })
  },

  async show(req: Request, res: Response) {
    const plugins = await getInstalledPlugins()
    const plugin = plugins.find(p => p.name === req.params.name)

    if (!plugin) {
      return res.json({ error: 'Plugin not found' }, 404)
    }

    const enabledPlugins = await Settings.getEnabledPlugins()
    res.json({ plugin: { ...plugin, active: enabledPlugins.includes(plugin.name) } })
  },

  async activate(req: Request, res: Response) {
    const { name } = req.body as { name: string }

    if (!name) {
      return res.json({ errors: { name: ['Plugin name is required'] } }, 422)
    }

    const plugins = await getInstalledPlugins()
    const plugin = plugins.find(p => p.name === name)

    if (!plugin) {
      return res.json({ error: 'Plugin not found' }, 404)
    }

    const enabledPlugins = await Settings.getEnabledPlugins()

    if (!enabledPlugins.includes(name)) {
      enabledPlugins.push(name)
      await Settings.setEnabledPlugins(enabledPlugins)
    }

    res.json({
      plugin: { ...plugin, active: true },
      message: `Plugin "${plugin.name}" activated. Restart the server to apply changes.`
    })
  },

  async deactivate(req: Request, res: Response) {
    const { name } = req.body as { name: string }

    if (!name) {
      return res.json({ errors: { name: ['Plugin name is required'] } }, 422)
    }

    const plugins = await getInstalledPlugins()
    const plugin = plugins.find(p => p.name === name)

    if (!plugin) {
      return res.json({ error: 'Plugin not found' }, 404)
    }

    const enabledPlugins = await Settings.getEnabledPlugins()
    const filtered = enabledPlugins.filter(p => p !== name)
    await Settings.setEnabledPlugins(filtered)

    res.json({
      plugin: { ...plugin, active: false },
      message: `Plugin "${plugin.name}" deactivated. Restart the server to apply changes.`
    })
  },

  async getSettings(req: Request, res: Response) {
    const name = req.params.name
    const plugins = await getInstalledPlugins()
    const plugin = plugins.find(p => p.name === name)

    if (!plugin) {
      return res.json({ error: 'Plugin not found' }, 404)
    }

    // Get saved settings
    const savedSettings = await Settings.get(`plugin_settings_${name}`)
    let settings = plugin.settings || {}

    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings)
        settings = { ...settings, ...parsed }
      } catch {
        // Use default settings
      }
    }

    res.json({ settings })
  },

  async updateSettings(req: Request, res: Response) {
    const name = req.params.name
    const plugins = await getInstalledPlugins()
    const plugin = plugins.find(p => p.name === name)

    if (!plugin) {
      return res.json({ error: 'Plugin not found' }, 404)
    }

    const { settings } = req.body as { settings: Record<string, unknown> }

    if (!settings || typeof settings !== 'object') {
      return res.json({ errors: { settings: ['Settings object is required'] } }, 422)
    }

    await Settings.set(`plugin_settings_${name}`, JSON.stringify(settings), 'plugins')
    res.json({ settings })
  }
}

/**
 * The registered plugins, as the plugin manager knows them.
 *
 * This used to re-implement discovery here and pull metadata out of each
 * plugin's source with `content.match(/name:\s*['"]([^'"]+)['"]/)`. That reads
 * the first thing in the file that looks like a name — a string in a comment,
 * a nested config object, a route label — and returns nothing at all for a
 * plugin that computes its metadata rather than writing it as a literal.
 *
 * The manager has the real config, because the plugin was actually imported.
 * It covers both registration styles, so a plugin passed to `createServer`
 * shows up here alongside the ones found in `plugins/`, each carrying the
 * source the loader recorded when it registered them.
 *
 * It deliberately does not scan for itself when the list comes back empty. It
 * used to, as a fallback, and that made this page contradict the server: an app
 * configured with `pluginsDir: false` still saw its plugins/ directory listed
 * here, marked active, when the server had loaded none of it. No plugins is a
 * real answer, and the route only runs inside a server that has already booted.
 */
async function getInstalledPlugins(): Promise<PluginInfo[]> {
  const { plugins } = await import('@basicbenframework/core/plugins')

  return plugins.list() as PluginInfo[]
}
