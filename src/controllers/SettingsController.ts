import { Settings } from '../models/Settings.ts'
import { validateSettings, isKnownSetting, isSecretDefinition } from '../helpers/site-settings.ts'
import { siteUrl } from '../helpers/site.ts'
import { describeConfig, lockedBy, refreshConfig, registrationOpen } from '../helpers/config.ts'
import { encryptSecret } from '../helpers/secrets.ts'
import { isSecretSetting } from '../helpers/export-data.ts'
import type { Request, Response } from '../types/index.ts'
import { registeredFeatures } from '../host/index.ts'

/**
 * Site settings.
 *
 * Every write goes through `validateSettings`, which knows each key the site
 * uses and what it accepts (see helpers/site-settings.ts). The routes require
 * `settings.manage`, which only the admin role holds — that matters most for
 * code injection, which is raw HTML the front end renders unsanitised.
 *
 * Some settings are configuration the environment can also set (storage, the
 * site URL, mail keys: see helpers/config.ts). Where the variable is set it
 * wins, and a save leaves that setting alone. Secret settings are encrypted
 * before they are stored and are never sent back: reads report them as '' and
 * list which are set under `secrets`. A blank secret on save keeps the stored
 * one; DELETE /api/settings/:key clears it.
 */
const isSecret = (key: string) => isSecretDefinition(key) || isSecretSetting(key)

/** Settings with every secret blanked, and which secrets are set. */
function redact(settings: Record<string, string>) {
  const secrets: Record<string, boolean> = {}
  const visible: Record<string, string> = {}
  for (const [key, value] of Object.entries(settings)) {
    if (isSecret(key)) {
      secrets[key] = value !== ''
      visible[key] = ''
    } else {
      visible[key] = value
    }
  }
  return { settings: visible, secrets }
}

/**
 * Write validated settings. Locked ones (the environment sets them) are
 * skipped and reported; a blank secret keeps the stored value.
 */
async function writeSettings(values: Record<string, { value: string; group: string }>) {
  const skipped: Record<string, string> = {}

  for (const [key, { value, group }] of Object.entries(values)) {
    const env = lockedBy(key)
    if (env) {
      skipped[key] = env
      continue
    }

    // Secrets are never sent to the admin, so a form saves them back blank:
    // blank means unchanged. Only declared secrets are encrypted; a feature's
    // key that merely looks secret is stored as the feature reads it.
    if (isSecret(key) && value.trim() === '') continue
    await Settings.set(key, isSecretDefinition(key) ? encryptSecret(value.trim()) : value, group)
  }

  await refreshConfig({ force: true })
  return skipped
}

export const SettingsController = {
  async index(req: Request, res: Response) {
    const { settings, secrets } = redact(await Settings.asObject())

    // `config` says, for each value the environment can also set, where the
    // one in use comes from — so the admin can show which fields are locked.
    res.json({ settings, secrets, site_url: siteUrl(req), config: describeConfig(registeredFeatures()) })
  },

  async byGroup(req: Request, res: Response) {
    const { settings, secrets } = redact(await Settings.asObject(req.params.group))
    res.json({ settings, secrets })
  },

  async get(req: Request, res: Response) {
    const value = await Settings.get(req.params.key)
    if (value === null) {
      return res.json({ error: 'Setting not found' }, 404)
    }
    if (isSecret(req.params.key)) return res.json({ key: req.params.key, value: '', set: true })
    res.json({ key: req.params.key, value })
  },

  async update(req: Request, res: Response) {
    const { settings } = req.body as { settings?: unknown }

    const result = validateSettings(settings)
    if ('errors' in result) return res.json({ errors: result.errors }, 422)

    const skipped = await writeSettings(result.values)

    const updated = redact(await Settings.asObject())
    res.json({ ...updated, skipped, config: describeConfig(registeredFeatures()) })
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

    // One setting, named on purpose: a locked one is an error, not a skip.
    const env = lockedBy(req.params.key)
    if (env) {
      return res.json({ errors: { [req.params.key]: [`Set by ${env} in the environment`] } }, 422)
    }

    const stored = result.values[req.params.key]
    await writeSettings({ [req.params.key]: stored })
    res.json({ key: req.params.key, value: isSecretDefinition(req.params.key) ? '' : stored.value })
  },

  async delete(req: Request, res: Response) {
    // Deleting an unknown key is harmless, but refusing it keeps the API
    // consistent: every key this controller touches is one it knows about.
    // Legacy rows with unknown keys stay readable through `index`.
    if (!isKnownSetting(req.params.key)) {
      return res.json({ errors: { [req.params.key]: ['Unknown setting'] } }, 422)
    }

    await Settings.delete(req.params.key)
    await refreshConfig({ force: true })
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
  /**
   * `GET /api/site` — what the CMS's own screens brand themselves with: the
   * sign-in pages, the admin's sidebar, the browser tab. Public, since the
   * sign-in page is shown to people who are not signed in yet.
   */
  async getSiteInfo(req: Request, res: Response) {
    const [siteName, siteDescription, info, tagline, adminLocale] = await Promise.all([
      Settings.getSiteName(),
      Settings.getSiteDescription(),
      Settings.siteInfo(),
      Settings.get('login_tagline'),
      Settings.get('admin_locale')
    ])
    res.json({
      site_name: siteName,
      site_description: siteDescription,
      logo_url: info.logo_url,
      icon_url: info.icon_url,
      accent_color: info.accent_color,
      login_tagline: tagline || null,
      // The language of the sign-in pages, which have no session to ask.
      admin_locale: adminLocale || null,
      // For the sign-up links: DISABLE_REGISTRATION or the setting.
      registration_open: registrationOpen()
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

    await writeSettings(result.values)

    res.json({
      site_name: await Settings.getSiteName(),
      site_description: await Settings.getSiteDescription()
    })
  }
}
