import { Settings } from '../models/Settings.ts'
import { validateSettings, isKnownSetting } from '../helpers/site-settings.ts'
import { siteUrl } from '../helpers/site.ts'
import type { Request, Response } from '../types/index.ts'

/**
 * Site settings.
 *
 * Every write goes through `validateSettings`, which knows each key the site
 * uses and what it accepts (see helpers/site-settings.ts). The routes require
 * `settings.manage`, which only the admin role holds — that matters most for
 * code injection, which is raw HTML the front end renders unsanitised.
 */
export const SettingsController = {
  async index(req: Request, res: Response) {
    const settings = await Settings.asObject()

    // The site URL is configuration (SITE_URL), not a setting: it is shown so
    // the admin can see what feeds and the sitemap link to, and it is never
    // writable from here — a URL that can be changed from a form is one stolen
    // admin session away from pointing every feed reader somewhere else.
    res.json({ settings, site_url: siteUrl(req) })
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
    const { settings } = req.body as { settings?: unknown }

    const result = validateSettings(settings)
    if ('errors' in result) return res.json({ errors: result.errors }, 422)

    for (const [key, { value, group }] of Object.entries(result.values)) {
      await Settings.set(key, value, group)
    }

    const updated = await Settings.asObject()
    res.json({ settings: updated })
  },

  async set(req: Request, res: Response) {
    const { value } = req.body as { value?: unknown }

    if (value === undefined) {
      return res.json({ errors: { value: ['Value is required'] } }, 422)
    }

    // The group comes from the definition now, not the request: a client
    // naming its own group was how a setting ended up filed somewhere
    // `byGroup` would never find it.
    const result = validateSettings({ [req.params.key]: value })
    if ('errors' in result) return res.json({ errors: result.errors }, 422)

    const stored = result.values[req.params.key]
    await Settings.set(req.params.key, stored.value, stored.group)
    res.json({ key: req.params.key, value: stored.value })
  },

  async delete(req: Request, res: Response) {
    // Deleting an unknown key is harmless, but refusing it keeps the API
    // consistent: every key this controller touches is one it knows about.
    // Legacy rows with unknown keys stay readable through `index`.
    if (!isKnownSetting(req.params.key)) {
      return res.json({ errors: { [req.params.key]: ['Unknown setting'] } }, 422)
    }

    await Settings.delete(req.params.key)
    res.json({ message: 'Setting deleted' })
  },

  /**
   * `GET /api/v1/site` — the site's identity: name, description, URL, logo,
   * icon, default social image, time zone, locale and code injection.
   *
   * `code_injection` is admin-authored HTML for the front end to insert raw
   * into <head> and before </body>. It is deliberately not sanitised — it
   * exists to carry <script> tags — and only the admin role can set it.
   */
  async publicSite(_req: Request, res: Response) {
    res.json({ data: await Settings.siteInfo() })
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

    // Same rules as `update`, so this older endpoint is not a way around them.
    const result = validateSettings({
      ...(site_name ? { site_name } : {}),
      ...(site_description !== undefined ? { site_description } : {})
    })
    if ('errors' in result) return res.json({ errors: result.errors }, 422)

    for (const [key, { value, group }] of Object.entries(result.values)) {
      await Settings.set(key, value, group)
    }

    res.json({
      site_name: await Settings.getSiteName(),
      site_description: await Settings.getSiteDescription()
    })
  }
}
