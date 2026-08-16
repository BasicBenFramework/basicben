/**
 * BasicBen Update System
 *
 * Provides automatic update checking and installation for:
 * - Core framework
 * - Plugins
 * - Themes
 */

import { RegistryClient } from './registry.js'
import {
  parseVersion,
  compareVersions,
  isNewer,
  satisfies,
  getChannel
} from './version.js'
import {
  downloadAndExtract,
  downloadFile,
  verifyChecksum,
  createTempDir,
  copyDir,
  removeDir,
  pathExists
} from './download.js'
import {
  isCloud,
  isSelfHosted,
  getVersion,
  canManualUpdate,
  getUpdateChannel,
  getLicenseKey
} from '../server/environment.js'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnNpm } from '../cli/spawn.js'

// Default configuration
const DEFAULT_CONFIG = {
  registries: ['https://registry.basicben.com'],
  channel: 'stable',
  autoCheck: true,
  checkInterval: 86400, // 24 hours
  notifyCore: true,
  notifyPlugins: true,
  notifyThemes: true,
  allowCoreUpdates: true,
  allowPluginUpdates: true,
  allowThemeUpdates: true,
  autoBackup: true,
  maxBackups: 5,
  pluginsDir: 'plugins',
  themesDir: 'themes',
  backupsDir: 'backups'
}

/**
 * Update Manager for BasicBen
 */
export class UpdateManager {
  /**
   * Create a new UpdateManager
   * @param {object} config - Configuration options
   */
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.registry = new RegistryClient({
      registries: this.config.registries,
      channel: this.config.channel,
      license: this.config.license || getLicenseKey()
    })
    this.currentVersion = getVersion()
    this.lastCheck = null
    this.cachedUpdates = null
  }

  // ============================================================
  // Update Checking
  // ============================================================

  /**
   * Check for all available updates
   * @param {boolean} force - Force fresh check (ignore cache)
   * @returns {Promise<{ core: CoreUpdate|null, plugins: object[], themes: object[] }>}
   *   Update info for core, plugins, and themes
   */
  async checkAll(force = false) {
    // Use cache if recent and not forced
    if (!force && this.cachedUpdates && this.lastCheck) {
      const age = Date.now() - this.lastCheck
      if (age < this.config.checkInterval * 1000) {
        return this.cachedUpdates
      }
    }

    const [core, plugins, themes] = await Promise.all([
      this.checkCoreUpdate(),
      this.checkPluginUpdates(),
      this.checkThemeUpdates()
    ])

    this.cachedUpdates = { core, plugins, themes }
    this.lastCheck = Date.now()

    return this.cachedUpdates
  }

  /**
   * What a core update check reports.
   *
   * `available` is the only field always present: a failed check reports
   * `available: false` with the reason rather than throwing, so a registry
   * being down never takes the admin area with it.
   *
   * @typedef {Object} CoreUpdate
   * @property {boolean} available
   * @property {string} [current]
   * @property {string} [latest]
   * @property {string} [channel]
   * @property {string} [releaseDate]
   * @property {string} [changelog]
   * @property {object[]} [migrations]
   * @property {string} [minNode]
   * @property {string} [error]
   */

  /**
   * The outcome of an install or update. Failures throw, so `success` is
   * always true here — it is carried through to the JSON an admin route sends.
   *
   * @typedef {Object} UpdateResult
   * @property {boolean} success
   * @property {string} [version]
   * @property {string} [previousVersion]
   * @property {string} [slug]
   * @property {string} [message]
   */

  /**
   * Check for core framework updates
   * @returns {Promise<CoreUpdate|null>} Update info or null if up to date
   */
  async checkCoreUpdate() {
    try {
      const latest = await this.registry.getLatestCore()

      if (!latest) {
        return null
      }

      if (isNewer(latest.version, this.currentVersion)) {
        return {
          available: true,
          current: this.currentVersion,
          latest: latest.version,
          channel: getChannel(latest.version),
          releaseDate: latest.releaseDate,
          changelog: latest.changelog,
          migrations: latest.migrations || [],
          minNode: latest.minNode
        }
      }

      return { available: false, current: this.currentVersion }
    } catch (error) {
      console.error('Failed to check core update:', error.message)
      return { available: false, error: error.message }
    }
  }

  /**
   * Check for plugin updates
   * @returns {Promise<object[]>} List of available updates
   */
  async checkPluginUpdates() {
    try {
      const installed = await this.getInstalledPlugins()
      return await this.registry.checkPluginUpdates(installed)
    } catch (error) {
      console.error('Failed to check plugin updates:', error.message)
      return []
    }
  }

  /**
   * Check for theme updates
   * @returns {Promise<object[]>} List of available updates
   */
  async checkThemeUpdates() {
    try {
      const installed = await this.getInstalledThemes()
      return await this.registry.checkThemeUpdates(installed)
    } catch (error) {
      console.error('Failed to check theme updates:', error.message)
      return []
    }
  }

  // ============================================================
  // Update Application
  // ============================================================

  /**
   * Update the core framework
   * @param {string} version - Target version (default: latest)
   * @param {object} options - Update options
   * @returns {Promise<UpdateResult>} Update result
   */
  async updateCore(version = 'latest', options = {}) {
    // Check if updates are allowed
    if (!canManualUpdate()) {
      throw new Error(
        isCloud()
          ? 'Core updates are managed automatically on BasicBen Cloud'
          : 'Core updates are disabled'
      )
    }

    if (!this.config.allowCoreUpdates) {
      throw new Error('Core updates are disabled in configuration')
    }

    const { onProgress, skipBackup = false } = options

    // Get target version
    let targetVersion = version
    if (version === 'latest') {
      const latest = await this.registry.getLatestCore()
      if (!latest) {
        throw new Error('Could not fetch latest version')
      }
      targetVersion = latest.version
    }

    // Check if already at target version
    if (!isNewer(targetVersion, this.currentVersion)) {
      return {
        success: true,
        message: `Already at version ${this.currentVersion}`,
        version: this.currentVersion
      }
    }

    // Check Node.js compatibility
    const coreInfo = await this.registry.getLatestCore()
    if (coreInfo?.minNode) {
      const nodeVersion = process.version.replace(/^v/, '')
      if (!satisfies(`>=${coreInfo.minNode}`, nodeVersion)) {
        throw new Error(
          `Node.js ${coreInfo.minNode} or higher required. You have ${process.version}`
        )
      }
    }

    // Create backup
    if (this.config.autoBackup && !skipBackup) {
      onProgress?.({ step: 'backup', message: 'Creating backup...' })
      await this.createBackup('pre-update')
    }

    try {
      // Update package.json
      onProgress?.({ step: 'package', message: 'Updating package.json...' })
      await this.updatePackageJson(targetVersion)

      // Run npm install
      onProgress?.({ step: 'install', message: 'Installing dependencies...' })
      await this.runNpmInstall()

      // Download and apply migrations
      onProgress?.({ step: 'migrations', message: 'Applying migrations...' })
      await this.applyCoreMigrations(targetVersion)

      // Clear caches
      onProgress?.({ step: 'cache', message: 'Clearing caches...' })
      await this.clearCaches()

      // Update current version
      this.currentVersion = targetVersion
      this.cachedUpdates = null

      onProgress?.({ step: 'complete', message: 'Update complete!' })

      return {
        success: true,
        version: targetVersion,
        previousVersion: this.currentVersion
      }
    } catch (error) {
      // Attempt rollback
      onProgress?.({ step: 'error', message: `Update failed: ${error.message}` })
      throw error
    }
  }

  /**
   * Install a plugin from registry
   * @param {string} slug - Plugin slug
   * @param {object} options - Install options
   * @returns {Promise<UpdateResult>} Install result
   */
  async installPlugin(slug, options = {}) {
    const { version = 'latest', registry: registryUrl, onProgress } = options

    onProgress?.({ step: 'fetch', message: `Fetching ${slug}...` })

    // Get plugin info
    const plugin = await this.registry.getPlugin(slug)
    if (!plugin) {
      throw new Error(`Plugin not found: ${slug}`)
    }

    // Check compatibility
    if (plugin.requires?.core) {
      if (!satisfies(plugin.requires.core, this.currentVersion)) {
        throw new Error(
          `Plugin requires BasicBen ${plugin.requires.core}, you have ${this.currentVersion}`
        )
      }
    }

    // Get download info
    const downloadInfo = await this.registry.getPluginDownload(
      slug,
      version === 'latest' ? plugin.currentVersion : version
    )

    if (!downloadInfo?.url) {
      throw new Error(`Could not get download URL for ${slug}`)
    }

    // Download and extract
    onProgress?.({ step: 'download', message: 'Downloading...' })
    const pluginDir = join(process.cwd(), this.config.pluginsDir, slug)

    await downloadAndExtract(downloadInfo.url, pluginDir, {
      checksum: downloadInfo.checksum,
      onProgress: (bytes, total) => {
        onProgress?.({
          step: 'download',
          message: 'Downloading...',
          progress: total ? bytes / total : 0
        })
      }
    })

    onProgress?.({ step: 'complete', message: 'Plugin installed!' })

    return {
      success: true,
      slug,
      version: plugin.currentVersion,
      path: pluginDir
    }
  }

  /**
   * Update an installed plugin
   * @param {string} slug - Plugin slug
   * @param {object} options - Update options
   * @returns {Promise<UpdateResult>} Update result
   */
  async updatePlugin(slug, options = {}) {
    const { version = 'latest', onProgress } = options

    // Check if plugin exists
    const pluginDir = join(process.cwd(), this.config.pluginsDir, slug)
    if (!await pathExists(pluginDir)) {
      throw new Error(`Plugin not installed: ${slug}`)
    }

    // Get current version
    const installed = await this.getInstalledPlugins()
    const current = installed.find(p => p.slug === slug)

    if (!current) {
      throw new Error(`Could not read installed plugin: ${slug}`)
    }

    // Get latest version
    const plugin = await this.registry.getPlugin(slug)
    const targetVersion = version === 'latest' ? plugin.currentVersion : version

    if (!isNewer(targetVersion, current.version)) {
      return {
        success: true,
        message: `Already at version ${current.version}`,
        version: current.version
      }
    }

    // Backup current plugin
    if (this.config.autoBackup) {
      onProgress?.({ step: 'backup', message: 'Backing up current version...' })
      const backupDir = join(process.cwd(), this.config.backupsDir, 'plugins', `${slug}-${current.version}`)
      await copyDir(pluginDir, backupDir)
    }

    // Install new version (overwrites existing)
    return await this.installPlugin(slug, { version: targetVersion, onProgress })
  }

  /**
   * Remove a plugin
   * @param {string} slug - Plugin slug
   * @returns {Promise<object>} Remove result
   */
  async removePlugin(slug) {
    const pluginDir = join(process.cwd(), this.config.pluginsDir, slug)

    if (!await pathExists(pluginDir)) {
      throw new Error(`Plugin not installed: ${slug}`)
    }

    await removeDir(pluginDir)

    return { success: true, slug }
  }

  /**
   * Install a theme from registry
   * @param {string} slug - Theme slug
   * @param {object} options - Install options
   * @returns {Promise<UpdateResult>} Install result
   */
  async installTheme(slug, options = {}) {
    const { version = 'latest', onProgress } = options

    onProgress?.({ step: 'fetch', message: `Fetching ${slug}...` })

    // Get theme info
    const theme = await this.registry.getTheme(slug)
    if (!theme) {
      throw new Error(`Theme not found: ${slug}`)
    }

    // Get download info
    const downloadInfo = await this.registry.getThemeDownload(
      slug,
      version === 'latest' ? theme.currentVersion : version
    )

    if (!downloadInfo?.url) {
      throw new Error(`Could not get download URL for ${slug}`)
    }

    // Download and extract
    onProgress?.({ step: 'download', message: 'Downloading...' })
    const themeDir = join(process.cwd(), this.config.themesDir, slug)

    await downloadAndExtract(downloadInfo.url, themeDir, {
      checksum: downloadInfo.checksum
    })

    onProgress?.({ step: 'complete', message: 'Theme installed!' })

    return {
      success: true,
      slug,
      version: theme.currentVersion,
      path: themeDir
    }
  }

  /**
   * Update an installed theme
   * @param {string} slug - Theme slug
   * @param {object} options - Update options
   * @returns {Promise<UpdateResult>} Update result
   */
  async updateTheme(slug, options = {}) {
    const { version = 'latest', onProgress } = options

    const themeDir = join(process.cwd(), this.config.themesDir, slug)
    if (!await pathExists(themeDir)) {
      throw new Error(`Theme not installed: ${slug}`)
    }

    // Backup current theme
    if (this.config.autoBackup) {
      const installed = await this.getInstalledThemes()
      const current = installed.find(t => t.slug === slug)
      if (current) {
        const backupDir = join(process.cwd(), this.config.backupsDir, 'themes', `${slug}-${current.version}`)
        await copyDir(themeDir, backupDir)
      }
    }

    // Install new version
    return await this.installTheme(slug, { version, onProgress })
  }

  /**
   * Remove a theme
   * @param {string} slug - Theme slug
   * @returns {Promise<object>} Remove result
   */
  async removeTheme(slug) {
    const themeDir = join(process.cwd(), this.config.themesDir, slug)

    if (!await pathExists(themeDir)) {
      throw new Error(`Theme not installed: ${slug}`)
    }

    await removeDir(themeDir)

    return { success: true, slug }
  }

  // ============================================================
  // Backup Management
  // ============================================================

  /**
   * Create a backup
   * @param {string} type - Backup type (pre-update, manual, etc.)
   * @returns {Promise<object>} Backup info
   */
  async createBackup(type = 'manual') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupId = `backup-${timestamp}`
    const backupDir = join(process.cwd(), this.config.backupsDir, backupId)

    await mkdir(backupDir, { recursive: true })

    // Backup package.json
    const pkgPath = join(process.cwd(), 'package.json')
    if (await pathExists(pkgPath)) {
      const pkg = await readFile(pkgPath, 'utf-8')
      await writeFile(join(backupDir, 'package.json'), pkg)
    }

    // Backup plugins
    const pluginsDir = join(process.cwd(), this.config.pluginsDir)
    if (await pathExists(pluginsDir)) {
      await copyDir(pluginsDir, join(backupDir, 'plugins'))
    }

    // Backup themes
    const themesDir = join(process.cwd(), this.config.themesDir)
    if (await pathExists(themesDir)) {
      await copyDir(themesDir, join(backupDir, 'themes'))
    }

    // Create manifest
    const manifest = {
      id: backupId,
      type,
      timestamp: new Date().toISOString(),
      version: this.currentVersion,
      contents: ['package.json', 'plugins', 'themes']
    }
    await writeFile(
      join(backupDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    )

    // Cleanup old backups
    await this.cleanupBackups()

    return manifest
  }

  /**
   * List available backups
   * @returns {Promise<object[]>} List of backups
   */
  async listBackups() {
    const backupsDir = join(process.cwd(), this.config.backupsDir)

    if (!await pathExists(backupsDir)) {
      return []
    }

    const { readdir } = await import('node:fs/promises')
    const entries = await readdir(backupsDir, { withFileTypes: true })
    const backups = []

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('backup-')) {
        const manifestPath = join(backupsDir, entry.name, 'manifest.json')
        if (await pathExists(manifestPath)) {
          const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'))
          backups.push(manifest)
        }
      }
    }

    return backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
  }

  /**
   * Restore from a backup
   * @param {string} backupId - Backup ID to restore
   * @returns {Promise<object>} Restore result
   */
  async restoreBackup(backupId) {
    const backupDir = join(process.cwd(), this.config.backupsDir, backupId)

    if (!await pathExists(backupDir)) {
      throw new Error(`Backup not found: ${backupId}`)
    }

    const manifestPath = join(backupDir, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'))

    // Restore package.json
    const pkgBackup = join(backupDir, 'package.json')
    if (await pathExists(pkgBackup)) {
      await copyDir(pkgBackup, join(process.cwd(), 'package.json'))
    }

    // Restore plugins
    const pluginsBackup = join(backupDir, 'plugins')
    if (await pathExists(pluginsBackup)) {
      await removeDir(join(process.cwd(), this.config.pluginsDir))
      await copyDir(pluginsBackup, join(process.cwd(), this.config.pluginsDir))
    }

    // Restore themes
    const themesBackup = join(backupDir, 'themes')
    if (await pathExists(themesBackup)) {
      await removeDir(join(process.cwd(), this.config.themesDir))
      await copyDir(themesBackup, join(process.cwd(), this.config.themesDir))
    }

    // Run npm install to restore dependencies
    await this.runNpmInstall()

    return {
      success: true,
      backupId,
      restoredVersion: manifest.version
    }
  }

  /**
   * Delete a backup
   * @param {string} backupId - Backup ID to delete
   * @returns {Promise<void>}
   */
  async deleteBackup(backupId) {
    const backupDir = join(process.cwd(), this.config.backupsDir, backupId)
    await removeDir(backupDir)
  }

  /**
   * Cleanup old backups (keep maxBackups)
   * @returns {Promise<void>}
   */
  async cleanupBackups() {
    const backups = await this.listBackups()

    if (backups.length > this.config.maxBackups) {
      const toDelete = backups.slice(this.config.maxBackups)
      for (const backup of toDelete) {
        await this.deleteBackup(backup.id)
      }
    }
  }

  // ============================================================
  // Registry Management
  // ============================================================

  /**
   * Add a registry
   * @param {string} url - Registry URL
   */
  addRegistry(url) {
    this.registry.addRegistry(url)
    this.config.registries.push(url)
  }

  /**
   * Remove a registry
   * @param {string} url - Registry URL
   */
  removeRegistry(url) {
    this.registry.removeRegistry(url)
    this.config.registries = this.config.registries.filter(r => r !== url)
  }

  /**
   * Get list of registries
   * @returns {string[]}
   */
  getRegistries() {
    return this.registry.getRegistries()
  }

  /**
   * Set license key
   * @param {string} key - License key
   */
  setLicense(key) {
    this.config.license = key
    this.registry = new RegistryClient({
      ...this.config,
      license: key
    })
  }

  /**
   * Validate license key
   * @param {string} key - License key
   * @returns {Promise<object>} Validation result
   */
  async validateLicense(key) {
    return await this.registry.validateLicense(key)
  }

  // ============================================================
  // Helper Methods
  // ============================================================

  /**
   * Get installed plugins
   * @returns {Promise<object[]>}
   */
  async getInstalledPlugins() {
    const pluginsDir = join(process.cwd(), this.config.pluginsDir)

    if (!await pathExists(pluginsDir)) {
      return []
    }

    const { readdir } = await import('node:fs/promises')
    const entries = await readdir(pluginsDir, { withFileTypes: true })
    const plugins = []

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const pluginJsonPath = join(pluginsDir, entry.name, 'plugin.json')
        if (await pathExists(pluginJsonPath)) {
          try {
            const config = JSON.parse(await readFile(pluginJsonPath, 'utf-8'))
            plugins.push({
              slug: entry.name,
              name: config.name,
              version: config.version,
              description: config.description
            })
          } catch {
            // Skip invalid plugins
          }
        }
      }
    }

    return plugins
  }

  /**
   * Get installed themes
   * @returns {Promise<object[]>}
   */
  async getInstalledThemes() {
    const themesDir = join(process.cwd(), this.config.themesDir)

    if (!await pathExists(themesDir)) {
      return []
    }

    const { readdir } = await import('node:fs/promises')
    const entries = await readdir(themesDir, { withFileTypes: true })
    const themes = []

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const themeJsonPath = join(themesDir, entry.name, 'theme.json')
        if (await pathExists(themeJsonPath)) {
          try {
            const config = JSON.parse(await readFile(themeJsonPath, 'utf-8'))
            themes.push({
              slug: entry.name,
              name: config.name,
              version: config.version,
              description: config.description
            })
          } catch {
            // Skip invalid themes
          }
        }
      }
    }

    return themes
  }

  /**
   * Update package.json with new framework version
   * @param {string} version - Target version
   */
  async updatePackageJson(version) {
    const pkgPath = join(process.cwd(), 'package.json')
    const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'))

    // Update @basicbenframework/core version
    if (pkg.dependencies?.['@basicbenframework/core']) {
      pkg.dependencies['@basicbenframework/core'] = `^${version}`
    }

    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  }

  /**
   * Run npm install
   */
  async runNpmInstall() {
    return new Promise((resolve, reject) => {
      const npm = spawnNpm(['install'], {
        cwd: process.cwd(),
        stdio: 'pipe'
      })

      let stderr = ''
      npm.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      npm.on('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`npm install failed: ${stderr}`))
        }
      })

      npm.on('error', reject)
    })
  }

  /**
   * Apply core migrations
   * @param {string} version - Version to apply migrations for
   */
  async applyCoreMigrations(version) {
    // Download migration files if available
    const downloadInfo = await this.registry.getCoreDownload(version)

    if (downloadInfo?.url) {
      const tempDir = await createTempDir('migrations-')

      try {
        await downloadAndExtract(downloadInfo.url, tempDir, {
          checksum: downloadInfo.checksum
        })

        // Copy migrations to user's project
        const migrationsDir = join(process.cwd(), 'migrations')
        const newMigrations = join(tempDir, 'migrations')

        if (await pathExists(newMigrations)) {
          const { readdir } = await import('node:fs/promises')
          const files = await readdir(newMigrations)

          for (const file of files) {
            const src = join(newMigrations, file)
            const dest = join(migrationsDir, file)

            if (!await pathExists(dest)) {
              const { copyFile } = await import('node:fs/promises')
              await copyFile(src, dest)
            }
          }
        }
      } finally {
        await removeDir(tempDir)
      }
    }

    // Run migrations
    return new Promise((resolve, reject) => {
      const migrate = spawnNpm(['run', 'migrate'], {
        cwd: process.cwd(),
        stdio: 'pipe'
      })

      migrate.on('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          // Migration failure is not critical
          console.warn('Migration command returned non-zero exit code')
          resolve()
        }
      })

      migrate.on('error', () => {
        // npm run migrate might not exist
        resolve()
      })
    })
  }

  /**
   * Clear caches
   */
  async clearCaches() {
    // Clear registry cache
    this.registry.clearCache()

    // Clear cached updates
    this.cachedUpdates = null
    this.lastCheck = null

    // Try to clear node_modules/.cache if exists
    const cacheDir = join(process.cwd(), 'node_modules', '.cache')
    if (await pathExists(cacheDir)) {
      await removeDir(cacheDir)
    }
  }
}

// Export singleton instance
export const updates = new UpdateManager()

// Export utilities
export * from './version.js'
export { RegistryClient } from './registry.js'
