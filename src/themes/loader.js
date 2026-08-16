/**
 * Theme Loader for BasicBen CMS
 *
 * Scans the themes directory and loads all themes automatically.
 * Each theme should be a directory with a theme.json configuration file.
 */

import { readdirSync, existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { themes } from './index.js'

/**
 * Load all themes from a directory
 *
 * @param {string} dir - Directory to scan (default: themes)
 * @param {Object} [options] - Loading options
 * @param {string} [options.activeTheme] - Theme to activate after loading
 * @param {Object} options.context - Application context
 * @returns {Promise<{loaded: string[], errors: Array<{name: string, error: string}>}>}
 */
export async function loadThemes(dir = 'themes', options = {}) {
  const { activeTheme, context = {} } = options
  const themesDir = resolve(process.cwd(), dir)

  const result = {
    loaded: [],
    errors: []
  }

  if (!existsSync(themesDir)) {
    return result
  }

  // Set context for themes
  themes.setContext(context)

  const entries = readdirSync(themesDir)

  for (const entry of entries) {
    // Skip hidden files
    if (entry.startsWith('.')) {
      continue
    }

    const fullPath = join(themesDir, entry)
    const stat = statSync(fullPath)

    if (!stat.isDirectory()) {
      continue
    }

    try {
      const themeConfig = await loadTheme(fullPath, entry)

      if (themeConfig) {
        themes.register(themeConfig)
        result.loaded.push(themeConfig.slug)
      }
    } catch (err) {
      result.errors.push({
        name: entry,
        error: err.message
      })
      console.error(`Error loading theme "${entry}":`, err.message)
    }
  }

  // Activate theme if specified
  if (activeTheme && themes.themes.has(activeTheme)) {
    await themes.activate(activeTheme)
  } else if (result.loaded.length > 0) {
    // Activate first theme if none specified
    await themes.activate(result.loaded[0])
  }

  return result
}

/**
 * Load a theme from a directory
 *
 * @param {string} dir - Theme directory path
 * @param {string} slug - Theme slug (directory name)
 * @returns {Promise<Object|null>}
 */
async function loadTheme(dir, slug) {
  // Look for theme.json
  const configPath = join(dir, 'theme.json')

  if (!existsSync(configPath)) {
    console.warn(`Theme "${slug}" has no theme.json, skipping...`)
    return null
  }

  // Read theme configuration
  const configContent = readFileSync(configPath, 'utf-8')
  const config = JSON.parse(configContent)

  // Set slug from directory name if not specified
  config.slug = config.slug || slug

  // Resolve relative paths
  if (config.screenshot) {
    config.screenshotPath = join(dir, config.screenshot)
  }

  // Load layouts if they exist
  const layoutsDir = join(dir, 'layouts')
  if (existsSync(layoutsDir)) {
    config.layoutsDir = layoutsDir
    config.availableLayouts = []

    const layoutFiles = readdirSync(layoutsDir)
    for (const file of layoutFiles) {
      if (file.endsWith('.jsx') || file.endsWith('.tsx') || file.endsWith('.js')) {
        const layoutName = file.replace(/\.(jsx|tsx|js)$/, '')
        config.availableLayouts.push(layoutName)
      }
    }
  }

  // Load components list if they exist
  const componentsDir = join(dir, 'components')
  if (existsSync(componentsDir)) {
    config.componentsDir = componentsDir
    config.availableComponents = []

    const componentFiles = readdirSync(componentsDir)
    for (const file of componentFiles) {
      if (file.endsWith('.jsx') || file.endsWith('.tsx') || file.endsWith('.js')) {
        const componentName = file.replace(/\.(jsx|tsx|js)$/, '')
        config.availableComponents.push(componentName)
      }
    }
  }

  // Get styles
  const stylesDir = join(dir, 'styles')
  if (existsSync(stylesDir)) {
    config.stylesDir = stylesDir
    config.availableStyles = []

    const styleFiles = readdirSync(stylesDir)
    for (const file of styleFiles) {
      if (file.endsWith('.css')) {
        config.availableStyles.push(file)
      }
    }
  }

  // Get assets
  const assetsDir = join(dir, 'assets')
  if (existsSync(assetsDir)) {
    config.assetsDir = assetsDir
  }

  // Load initialize function if exists
  const initPath = join(dir, 'index.js')
  if (existsSync(initPath)) {
    try {
      const fileUrl = pathToFileURL(initPath).href
      const module = await import(fileUrl)

      if (typeof module.initialize === 'function') {
        config.initialize = module.initialize
      }

      if (typeof module.layouts === 'object') {
        config.layouts = module.layouts
      }

      if (typeof module.components === 'object') {
        config.components = module.components
      }
    } catch (err) {
      console.warn(`Failed to load theme "${slug}" module:`, err.message)
    }
  }

  return config
}

/**
 * Scan themes directory without loading them
 *
 * @param {string} dir - Directory to scan
 * @returns {Array<{slug: string, name: string, path: string, hasConfig: boolean}>}
 */
export function scanThemes(dir = 'themes') {
  const themesDir = resolve(process.cwd(), dir)
  const result = []

  if (!existsSync(themesDir)) {
    return result
  }

  const entries = readdirSync(themesDir)

  for (const entry of entries) {
    if (entry.startsWith('.')) {
      continue
    }

    const fullPath = join(themesDir, entry)
    const stat = statSync(fullPath)

    if (!stat.isDirectory()) {
      continue
    }

    const configPath = join(fullPath, 'theme.json')
    const hasConfig = existsSync(configPath)

    let name = entry
    if (hasConfig) {
      try {
        const configContent = readFileSync(configPath, 'utf-8')
        const config = JSON.parse(configContent)
        name = config.name || entry
      } catch {
        // Use directory name as fallback
      }
    }

    result.push({
      slug: entry,
      name,
      path: fullPath,
      hasConfig
    })
  }

  return result
}

/**
 * Get the main CSS file path for a theme
 *
 * @param {string} slug - Theme slug
 * @param {string} dir - Themes directory
 * @returns {string|null}
 */
export function getThemeStylePath(slug, dir = 'themes') {
  const themePath = resolve(process.cwd(), dir, slug)

  // Check common locations for main CSS file
  const possiblePaths = [
    join(themePath, 'styles', 'main.css'),
    join(themePath, 'styles', 'style.css'),
    join(themePath, 'style.css'),
    join(themePath, 'main.css')
  ]

  for (const cssPath of possiblePaths) {
    if (existsSync(cssPath)) {
      return cssPath
    }
  }

  return null
}

/**
 * Get the variables CSS file path for a theme
 *
 * @param {string} slug - Theme slug
 * @param {string} dir - Themes directory
 * @returns {string|null}
 */
export function getThemeVariablesPath(slug, dir = 'themes') {
  const themePath = resolve(process.cwd(), dir, slug)

  const possiblePaths = [
    join(themePath, 'styles', 'variables.css'),
    join(themePath, 'variables.css')
  ]

  for (const cssPath of possiblePaths) {
    if (existsSync(cssPath)) {
      return cssPath
    }
  }

  return null
}
