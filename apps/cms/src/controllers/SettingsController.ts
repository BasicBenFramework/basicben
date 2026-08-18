import { Settings } from '../models/Settings'
import type { Request, Response } from '../types'

export const SettingsController = {
  async index(req: Request, res: Response) {
    const settings = await Settings.asObject()
    res.json({ settings })
  },

  async byGroup(req: Request, res: Response) {
    const settings = await Settings.asObject(req.params.group)
    res.json({ settings })
  },

  async get(req: Request, res: Response) {
    const value = await Settings.get(req.params.key)
    if (value === null) {
      return res.json({ error: 'Setting not found' }, 404)
    }
    res.json({ key: req.params.key, value })
  },

  async update(req: Request, res: Response) {
    const { settings } = req.body as { settings: Record<string, string | number | boolean> }

    if (!settings || typeof settings !== 'object') {
      return res.json({ errors: { settings: ['Settings object is required'] } }, 422)
    }

    for (const [key, value] of Object.entries(settings)) {
      await Settings.set(key, value)
    }

    const updated = await Settings.asObject()
    res.json({ settings: updated })
  },

  async set(req: Request, res: Response) {
    const { value, group } = req.body as { value: string | number | boolean; group?: string }

    if (value === undefined) {
      return res.json({ errors: { value: ['Value is required'] } }, 422)
    }

    await Settings.set(req.params.key, value, group)
    res.json({ key: req.params.key, value })
  },

  async delete(req: Request, res: Response) {
    await Settings.delete(req.params.key)
    res.json({ message: 'Setting deleted' })
  },

  // Convenience endpoints for common settings
  async getSiteInfo(req: Request, res: Response) {
    const siteName = await Settings.getSiteName()
    const siteDescription = await Settings.getSiteDescription()
    res.json({
      site_name: siteName,
      site_description: siteDescription
    })
  },

  async updateSiteInfo(req: Request, res: Response) {
    const { site_name, site_description } = req.body as {
      site_name?: string
      site_description?: string
    }

    if (site_name) {
      await Settings.set('site_name', site_name, 'general')
    }
    if (site_description !== undefined) {
      await Settings.set('site_description', site_description, 'general')
    }

    res.json({
      site_name: await Settings.getSiteName(),
      site_description: await Settings.getSiteDescription()
    })
  }
}
