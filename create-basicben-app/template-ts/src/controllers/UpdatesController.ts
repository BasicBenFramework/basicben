import { updates, UpdateManager } from '@basicbenframework/core'

interface Request {
  query: { force?: string }
  params: { [key: string]: string }
  body: { [key: string]: any }
}

interface Response {
  json: (data: any, statusCode?: number) => void
  status: (code: number) => Response
}

// Cache for update checks
let lastCheck: Date | null = null
let cachedUpdates: any = null
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export const UpdatesController = {
  /**
   * Check for all available updates
   */
  async check(req: Request, res: Response) {
    try {
      const force = req.query.force === 'true'

      // Return cached if available and not forcing
      if (!force && cachedUpdates && lastCheck) {
        const age = Date.now() - lastCheck.getTime()
        if (age < CACHE_TTL) {
          return res.json({
            ...cachedUpdates,
            lastChecked: lastCheck.toISOString(),
            cached: true
          })
        }
      }

      // Check for updates
      const result = await updates.checkAll(force)

      // Cache result
      cachedUpdates = {
        core: result.core,
        plugins: result.plugins || []
      }
      lastCheck = new Date()

      res.json({
        ...cachedUpdates,
        lastChecked: lastCheck.toISOString()
      })
    } catch (error: any) {
      res.json({
        error: error.message || 'Failed to check for updates'
      }, 500)
    }
  },

  /**
   * Check for core updates only
   */
  async checkCore(req: Request, res: Response) {
    try {
      const result = await updates.checkCoreUpdate()
      res.json(result)
    } catch (error: any) {
      res.json({
        error: error.message || 'Failed to check core updates'
      }, 500)
    }
  },

  /**
   * Check for plugin updates only
   */
  async checkPlugins(req: Request, res: Response) {
    try {
      const result = await updates.checkPluginUpdates()
      res.json({ plugins: result })
    } catch (error: any) {
      res.json({
        error: error.message || 'Failed to check plugin updates'
      }, 500)
    }
  },

  /**
   * Apply core update
   */
  async updateCore(req: Request, res: Response) {
    try {
      const { version, backup = true } = req.body

      const result = await updates.updateCore(version, {
        // UpdateManager reads `skipBackup`, so passing `backup` was silently
        // ignored — a caller asking to skip the backup was given one anyway.
        skipBackup: backup === false,
        // onProgress is called with { step, message }; typing it as a string
        // logged "[object Object]" for every step of every update.
        onProgress: ({ step, message }: { step: string; message: string }) => {
          console.log(`[Core Update] ${step}: ${message}`)
        }
      })

      // Clear cache
      cachedUpdates = null
      lastCheck = null

      res.json({
        success: true,
        version: result.version,
        message: 'Core updated successfully. Please restart the server.',
        requiresRestart: true
      })
    } catch (error: any) {
      res.json({
        error: error.message || 'Failed to update core'
      }, 500)
    }
  },

  /**
   * Update specific plugin
   */
  async updatePlugin(req: Request, res: Response) {
    try {
      const { slug } = req.params
      const { version } = req.body

      const result = await updates.updatePlugin(slug, {
        version,
        onProgress: ({ step, message }: { step: string; message: string }) => {
          console.log(`[Plugin Update: ${slug}] ${step}: ${message}`)
        }
      })

      // Clear cache
      cachedUpdates = null

      res.json({
        success: true,
        plugin: slug,
        version: result.version,
        message: `Plugin "${slug}" updated successfully`
      })
    } catch (error: any) {
      res.json({
        error: error.message || 'Failed to update plugin'
      }, 500)
    }
  },

  /**
   * Get changelog for a version
   */
  async changelog(req: Request, res: Response) {
    try {
      const { version } = req.params
      const changelog = await updates.registry.getCoreChangelog(version)

      if (!changelog) {
        return res.json({ error: 'Version not found' }, 404)
      }

      res.json({ version, changelog })
    } catch (error: any) {
      res.json({
        error: error.message || 'Failed to get changelog'
      }, 500)
    }
  },

  /**
   * Browse plugins from registry
   */
  async browsePlugins(req: Request, res: Response) {
    try {
      const { search, category, page = '1', limit = '20' } = req.query as any

      const result = await updates.registry.searchPlugins({
        search,
        category,
        page: parseInt(page),
        limit: parseInt(limit)
      })

      res.json(result)
    } catch (error: any) {
      res.json({
        error: error.message || 'Failed to browse plugins'
      }, 500)
    }
  },

  /**
   * Install plugin from registry
   */
  async installPlugin(req: Request, res: Response) {
    try {
      const { slug, version } = req.body

      if (!slug) {
        return res.json({ error: 'Plugin slug is required' }, 400)
      }

      const result = await updates.installPlugin(slug, {
        version,
        onProgress: ({ step, message }: { step: string; message: string }) => {
          console.log(`[Plugin Install: ${slug}] ${step}: ${message}`)
        }
      })

      res.json({
        success: true,
        plugin: slug,
        version: result.version,
        message: `Plugin "${slug}" installed successfully`
      })
    } catch (error: any) {
      res.json({
        error: error.message || 'Failed to install plugin'
      }, 500)
    }
  },

  /**
   * List backups
   */
  async listBackups(req: Request, res: Response) {
    try {
      const backups = await updates.listBackups()
      res.json({ backups })
    } catch (error: any) {
      res.json({
        error: error.message || 'Failed to list backups'
      }, 500)
    }
  },

  /**
   * Create backup
   */
  async createBackup(req: Request, res: Response) {
    try {
      const { type = 'manual' } = req.body
      const backup = await updates.createBackup(type)

      res.json({
        success: true,
        backup
      })
    } catch (error: any) {
      res.json({
        error: error.message || 'Failed to create backup'
      }, 500)
    }
  },

  /**
   * Restore from backup
   */
  async restoreBackup(req: Request, res: Response) {
    try {
      const { id } = req.params

      await updates.restoreBackup(id)

      res.json({
        success: true,
        message: 'Backup restored successfully. Please restart the server.',
        requiresRestart: true
      })
    } catch (error: any) {
      res.json({
        error: error.message || 'Failed to restore backup'
      }, 500)
    }
  }
}
