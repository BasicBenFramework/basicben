import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Settings } from '../models/Settings'
import type { Request, Response } from '../types'

const PLUGINS_DIR = 'plugins'

interface PluginInfo {
  name: string
  version: string
  description?: string
  author?: string
  active: boolean
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
 * The installed plugins, as the plugin manager knows them.
 *
 * This used to re-implement discovery here and pull metadata out of each
 * plugin's source with `content.match(/name:\s*['"]([^'"]+)['"]/)`. That reads
 * the first thing in the file that looks like a name — a string in a comment,
 * a nested config object, a route label — and returns nothing at all for a
 * plugin that computes its metadata rather than writing it as a literal.
 *
 * The manager has the real config, because the plugin was actually imported.
 */
async function getInstalledPlugins(): Promise<PluginInfo[]> {
  const { plugins } = await import('@basicbenframework/core/plugins')
  const { loadPlugins } = await import('@basicbenframework/core/plugins/loader')

  // In the server process these are already loaded at boot. Loading again is
  // idempotent — register() overwrites by name — and covers the case where this
  // controller runs somewhere the boot sequence has not.
  if (plugins.list().length === 0) {
    await loadPlugins(PLUGINS_DIR, { context: {} })
  }

  return plugins.list() as PluginInfo[]
}
