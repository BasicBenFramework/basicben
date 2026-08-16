import { hooks, HOOKS } from '@basicbenframework/core/hooks'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Settings } from '../models/Settings'
import type { Request, Response } from '../types'

const THEMES_DIR = 'themes'

interface ThemeInfo {
  slug: string
  name: string
  version: string
  description?: string
  author?: string
  screenshot?: string
  active: boolean
  settings?: Record<string, unknown>
}

export const ThemeController = {
  async index(req: Request, res: Response) {
    const themes = await getInstalledThemes()
    const activeTheme = await Settings.getActiveTheme()

    const themesWithStatus = themes.map(theme => ({
      ...theme,
      active: theme.slug === activeTheme
    }))

    res.json({ themes: themesWithStatus })
  },

  async active(req: Request, res: Response) {
    const activeTheme = await Settings.getActiveTheme()
    const themes = await getInstalledThemes()
    const theme = themes.find(t => t.slug === activeTheme)

    if (!theme) {
      return res.json({ error: 'Active theme not found' }, 404)
    }

    // A filter, so a plugin can decide which theme actually renders — preview
    // modes and per-audience themes both need to override the stored choice.
    const rendered = await hooks.filter(HOOKS.THEME_RENDER, { ...theme, active: true }, { req })

    res.json({ theme: rendered })
  },

  async show(req: Request, res: Response) {
    const themes = await getInstalledThemes()
    const theme = themes.find(t => t.slug === req.params.slug)

    if (!theme) {
      return res.json({ error: 'Theme not found' }, 404)
    }

    const activeTheme = await Settings.getActiveTheme()
    res.json({ theme: { ...theme, active: theme.slug === activeTheme } })
  },

  async activate(req: Request, res: Response) {
    const { slug } = req.body as { slug: string }

    if (!slug) {
      return res.json({ errors: { slug: ['Theme slug is required'] } }, 422)
    }

    const themes = await getInstalledThemes()
    const theme = themes.find(t => t.slug === slug)

    if (!theme) {
      return res.json({ error: 'Theme not found' }, 404)
    }

    await Settings.setActiveTheme(slug)
    res.json({ theme: { ...theme, active: true }, message: `Theme "${theme.name}" activated` })
  },

  async getSettings(req: Request, res: Response) {
    const slug = req.params.slug
    const themes = await getInstalledThemes()
    const theme = themes.find(t => t.slug === slug)

    if (!theme) {
      return res.json({ error: 'Theme not found' }, 404)
    }

    // Get saved settings
    const savedSettings = await Settings.get(`theme_settings_${slug}`)
    let settings = theme.settings || {}

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
    const slug = req.params.slug
    const themes = await getInstalledThemes()
    const theme = themes.find(t => t.slug === slug)

    if (!theme) {
      return res.json({ error: 'Theme not found' }, 404)
    }

    const { settings } = req.body as { settings: Record<string, unknown> }

    if (!settings || typeof settings !== 'object') {
      return res.json({ errors: { settings: ['Settings object is required'] } }, 422)
    }

    // Merge with existing settings
    const existingSettings = await Settings.get(`theme_settings_${slug}`)
    let currentSettings: Record<string, unknown> = {}

    if (existingSettings) {
      try {
        currentSettings = JSON.parse(existingSettings)
      } catch {
        // Start fresh
      }
    }

    const mergedSettings = deepMerge(currentSettings, settings)
    await Settings.set(`theme_settings_${slug}`, JSON.stringify(mergedSettings), 'appearance')

    res.json({ settings: mergedSettings })
  },

  async resetSettings(req: Request, res: Response) {
    const slug = req.params.slug
    const themes = await getInstalledThemes()
    const theme = themes.find(t => t.slug === slug)

    if (!theme) {
      return res.json({ error: 'Theme not found' }, 404)
    }

    await Settings.delete(`theme_settings_${slug}`)
    res.json({ settings: theme.settings || {}, message: 'Settings reset to defaults' })
  },

  async css(req: Request, res: Response) {
    const slug = req.params.slug || await Settings.getActiveTheme()
    const themePath = resolve(process.cwd(), THEMES_DIR, slug)

    // Look for main CSS file
    const possiblePaths = [
      join(themePath, 'styles', 'main.css'),
      join(themePath, 'styles', 'style.css'),
      join(themePath, 'style.css')
    ]

    for (const cssPath of possiblePaths) {
      if (existsSync(cssPath)) {
        const css = readFileSync(cssPath, 'utf-8')
        res.setHeader('Content-Type', 'text/css')
        res.end(css)
        return
      }
    }

    res.json({ error: 'Theme CSS not found' }, 404)
  }
}

async function getInstalledThemes(): Promise<ThemeInfo[]> {
  const themesPath = resolve(process.cwd(), THEMES_DIR)
  const themes: ThemeInfo[] = []

  if (!existsSync(themesPath)) {
    return themes
  }

  const entries = readdirSync(themesPath)

  for (const entry of entries) {
    if (entry.startsWith('.')) continue

    const themePath = join(themesPath, entry)
    const configPath = join(themePath, 'theme.json')

    if (!existsSync(configPath)) continue

    try {
      const configContent = readFileSync(configPath, 'utf-8')
      const config = JSON.parse(configContent)

      themes.push({
        slug: entry,
        name: config.name || entry,
        version: config.version || '1.0.0',
        description: config.description,
        author: config.author,
        screenshot: config.screenshot ? `/themes/${entry}/${config.screenshot}` : undefined,
        settings: config.settings,
        active: false
      })
    } catch (err) {
      console.error(`Error loading theme "${entry}":`, err)
    }
  }

  return themes
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target }

  for (const key of Object.keys(source)) {
    if (
      source[key] instanceof Object &&
      !Array.isArray(source[key]) &&
      key in target &&
      target[key] instanceof Object &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(
        target[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>
      )
    } else {
      result[key] = source[key]
    }
  }

  return result
}
