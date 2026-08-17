/**
 * Registry client for fetching updates and plugins
 */

import https from 'node:https'
import http from 'node:http'

const DEFAULT_REGISTRY = 'https://registry.basicben.com'
const API_VERSION = 'v1'

/**
 * Registry client for communicating with BasicBen registries
 */
export class RegistryClient {
  /**
   * Create a new registry client
   * @param {object} options - Configuration options
   * @param {string[]} options.registries - List of registry URLs
   * @param {string} options.channel - Release channel (stable, beta, dev)
   * @param {string} options.license - License key for premium content
   * @param {number} options.timeout - Request timeout in ms
   */
  constructor(options = {}) {
    this.registries = options.registries || [DEFAULT_REGISTRY]
    this.channel = options.channel || 'stable'
    this.license = options.license || null
    this.timeout = options.timeout || 30000
    this.cache = new Map()
    this.cacheTimeout = options.cacheTimeout || 300000 // 5 minutes

    /*
      Hosts that could not be reached, so the next call does not wait on them
      again.

      Without this a registry that does not resolve costs the full timeout on
      every request, multiplied by the number of configured registries, and the
      admin UI simply hangs. A name that does not resolve is not a slow server:
      it will not start resolving within the same page view, so asking again
      immediately buys nothing.
    */
    this.unreachable = new Map()
    this.unreachableFor = options.unreachableFor ?? 60000
  }

  /** Whether a host failed to resolve recently enough to skip. */
  #recentlyUnreachable(url) {
    const host = new URL(url).host
    const failedAt = this.unreachable.get(host)

    if (failedAt === undefined) return false
    if (Date.now() - failedAt < this.unreachableFor) return true

    this.unreachable.delete(host)
    return false
  }

  /**
   * Make an HTTP request
   * @param {string} url - Full URL to request
   * @param {object} options - Request options
   * @returns {Promise<object>} Response data
   */
  async request(url, options = {}) {
    if (this.#recentlyUnreachable(url)) {
      throw new Error(`Registry ${new URL(url).host} is unreachable`)
    }

    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url)
      const client = parsedUrl.protocol === 'https:' ? https : http

      const requestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'BasicBen-UpdateClient/1.0',
          ...options.headers
        },
        timeout: this.timeout
      }

      // Add authorization header if license is set
      if (this.license) {
        requestOptions.headers['Authorization'] = `Bearer ${this.license}`
      }

      const req = client.request(requestOptions, (res) => {
        let data = ''

        res.on('data', (chunk) => {
          data += chunk
        })

        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data))
            } catch {
              resolve(data)
            }
          } else if (res.statusCode === 404) {
            resolve(null)
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`))
          }
        })
      })

      // A name that does not resolve, a refused connection or a full timeout
      // all mean the same thing for the next call: do not wait on this host
      // again. Anything else — an HTTP error, bad JSON — leaves it alone,
      // because the host answered.
      const markUnreachable = () => this.unreachable.set(parsedUrl.host, Date.now())

      req.on('error', (error) => {
        if (['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'ETIMEDOUT'].includes(error.code)) {
          markUnreachable()
        }
        reject(error)
      })

      req.on('timeout', () => {
        req.destroy()
        markUnreachable()
        reject(new Error('Request timeout'))
      })

      if (options.body) {
        req.write(JSON.stringify(options.body))
      }

      req.end()
    })
  }

  /**
   * Get cached data or fetch fresh
   * @param {string} key - Cache key
   * @param {Function} fetcher - Function to fetch data
   * @returns {Promise<any>} Cached or fresh data
   */
  async getCached(key, fetcher) {
    const cached = this.cache.get(key)

    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data
    }

    const data = await fetcher()
    this.cache.set(key, { data, timestamp: Date.now() })
    return data
  }

  /**
   * Clear the cache
   */
  clearCache() {
    this.cache.clear()
  }

  /**
   * Try request across all registries, return first success
   * @param {string} path - API path
   * @returns {Promise<object|null>} Response data
   */
  async tryRegistries(path) {
    const errors = []

    for (const registry of this.registries) {
      try {
        const url = `${registry}/api/${API_VERSION}${path}`
        const result = await this.request(url)
        if (result !== null) {
          return { data: result, registry }
        }
      } catch (error) {
        errors.push({ registry, error: error.message })
      }
    }

    // All registries failed
    if (errors.length > 0) {
      throw new Error(
        `All registries failed: ${errors.map(e => `${e.registry}: ${e.error}`).join(', ')}`
      )
    }

    return null
  }

  // ============================================================
  // Core Updates
  // ============================================================

  /**
   * Get latest core version info
   * @returns {Promise<object>} Core version info
   */
  async getLatestCore() {
    return this.getCached(`core:${this.channel}`, async () => {
      const result = await this.tryRegistries(`/core?channel=${this.channel}`)
      return result?.data || null
    })
  }

  /**
   * Get all available core versions
   * @returns {Promise<object[]>} List of versions
   */
  async getCoreVersions() {
    return this.getCached('core:versions', async () => {
      const result = await this.tryRegistries('/core/versions')
      return result?.data || []
    })
  }

  /**
   * Get core version changelog
   * @param {string} version - Version to get changelog for
   * @returns {Promise<string|null>} Changelog markdown, or null if no registry
   *   has one for that version
   */
  async getCoreChangelog(version) {
    const result = await this.tryRegistries(`/core/changelog/${version}`)
    return result?.data || null
  }

  /**
   * Get download URL for core update
   * @param {string} version - Version to download
   * @returns {Promise<object>} Download info with URL and checksum
   */
  async getCoreDownload(version) {
    const result = await this.tryRegistries(`/core/download/${version}`)
    return result ? { ...result.data, registry: result.registry } : null
  }

  // ============================================================
  // Plugins
  // ============================================================

  /**
   * Search plugins in registry
   * @param {object} options - Search options
   * @param {string} options.search - Search query
   * @param {string} options.category - Category filter
   * @param {number} options.page - Page number
   * @param {number} options.limit - Results per page
   * @returns {Promise<object>} Search results
   */
  async searchPlugins(options = {}) {
    const params = new URLSearchParams()
    if (options.search) params.set('search', options.search)
    if (options.category) params.set('category', options.category)
    if (options.page) params.set('page', options.page.toString())
    if (options.limit) params.set('limit', options.limit.toString())

    const query = params.toString()
    const path = `/plugins${query ? `?${query}` : ''}`

    try {
      const result = await this.tryRegistries(path)
      return result?.data || { plugins: [], total: 0 }
    } catch {
      // Return empty list if registry is unavailable
      return { plugins: [], total: 0 }
    }
  }

  /**
   * Get plugin details
   * @param {string} slug - Plugin slug
   * @returns {Promise<object|null>} Plugin details
   */
  async getPlugin(slug) {
    const result = await this.tryRegistries(`/plugins/${slug}`)
    return result?.data || null
  }

  /**
   * Get download URL for plugin
   * @param {string} slug - Plugin slug
   * @param {string} version - Version to download (default: latest)
   * @returns {Promise<object>} Download info
   */
  async getPluginDownload(slug, version = 'latest') {
    const result = await this.tryRegistries(`/plugins/${slug}/download/${version}`)
    return result ? { ...result.data, registry: result.registry } : null
  }

  /**
   * Check for plugin updates
   * @param {object[]} installed - List of installed plugins with slug and version
   * @returns {Promise<object[]>} List of available updates
   */
  async checkPluginUpdates(installed) {
    const updates = []

    for (const plugin of installed) {
      try {
        const latest = await this.getPlugin(plugin.slug)
        if (latest && latest.currentVersion !== plugin.version) {
          const { compareVersions } = await import('./version.js')
          if (compareVersions(latest.currentVersion, plugin.version) > 0) {
            updates.push({
              slug: plugin.slug,
              name: latest.name,
              currentVersion: plugin.version,
              latestVersion: latest.currentVersion,
              changelog: latest.changelog
            })
          }
        }
      } catch {
        // Skip plugins that can't be checked
      }
    }

    return updates
  }

  // ============================================================
  // ============================================================

  // ============================================================
  // License
  // ============================================================

  /**
   * Validate license key
   * @param {string} key - License key
   * @returns {Promise<object>} License info
   */
  async validateLicense(key) {
    const result = await this.tryRegistries('/license/validate')

    // Make POST request with license key
    for (const registry of this.registries) {
      try {
        const url = `${registry}/api/${API_VERSION}/license/validate`
        const data = await this.request(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: { key }
        })
        if (data) {
          return data
        }
      } catch {
        // Try next registry
      }
    }

    return { valid: false }
  }

  // ============================================================
  // Registry Management
  // ============================================================

  /**
   * Add a registry
   * @param {string} url - Registry URL
   */
  addRegistry(url) {
    if (!this.registries.includes(url)) {
      this.registries.push(url)
    }
  }

  /**
   * Remove a registry
   * @param {string} url - Registry URL
   */
  removeRegistry(url) {
    const index = this.registries.indexOf(url)
    if (index > -1) {
      this.registries.splice(index, 1)
    }
  }

  /**
   * Set registry priority (move to front)
   * @param {string} url - Registry URL
   */
  prioritizeRegistry(url) {
    const index = this.registries.indexOf(url)
    if (index > 0) {
      this.registries.splice(index, 1)
      this.registries.unshift(url)
    }
  }

  /**
   * Get list of registries
   * @returns {string[]} Registry URLs
   */
  getRegistries() {
    return [...this.registries]
  }

  /**
   * Check if a registry is reachable
   * @param {string} url - Registry URL
   * @returns {Promise<boolean>} True if reachable
   */
  async pingRegistry(url) {
    try {
      await this.request(`${url}/api/${API_VERSION}/core`)
      return true
    } catch {
      return false
    }
  }
}

// Default registry client instance
export const registry = new RegistryClient()
