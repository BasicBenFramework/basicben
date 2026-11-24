/**
 * How the feature finds MySendbox: environment for secrets, site settings for
 * everything an admin may choose.
 *
 * - `MYSENDBOX_API_KEY`: a key with contacts and broadcasts scopes and no
 *   domain or mailbox limits. Without it the feature does nothing at all.
 * - `MYSENDBOX_WEBHOOK_SECRET`: the `whsec_…` secret of the webhook pointed
 *   at `/api/webhooks/mysendbox`. Without it that endpoint answers 404.
 * - `MYSENDBOX_API_URL`: only to point at another MySendbox, such as in tests.
 */

import { Settings } from '../../models/Settings.ts'
import { checks, type SettingDefinition } from '../../helpers/site-settings.ts'
import { createClient, type ClientOptions, type MySendboxClient } from './client.ts'

export const SETTINGS: Record<string, SettingDefinition> = {
  // The audience (MySendbox list) this site's members are in. Made on first
  // use when blank, named after the site.
  mysendbox_audience_id: { group: 'mysendbox', check: checks.text(64) },
  // Blank: the workspace's default From in MySendbox's marketing settings.
  mysendbox_from_address: { group: 'mysendbox', check: checks.emailOrBlank },
  mysendbox_from_name: { group: 'mysendbox', check: checks.text(100) },
  // How members an admin added or imported agreed to newsletters, in the
  // admin's words. Blank: they are not copied as subscribed (see contacts.ts).
  mysendbox_consent_attestation: { group: 'mysendbox', check: checks.text(1000) },
  // A MySendbox signup form (`frm_…`). With one, an added or imported member
  // without an attestation gets its double opt-in mail instead.
  mysendbox_form_id: { group: 'mysendbox', check: checks.text(64) }
}

export function apiKey(): string {
  return process.env.MYSENDBOX_API_KEY?.trim() || ''
}

export function webhookSecret(): string {
  return process.env.MYSENDBOX_WEBHOOK_SECRET?.trim() || ''
}

export function isConfigured(): boolean {
  return apiKey() !== ''
}

let overrides: Partial<ClientOptions> = {}

/** For tests: a fake `fetch`, or another base URL. */
export function setClientOptions(next: Partial<ClientOptions>): void {
  overrides = next
}

export function client(): MySendboxClient {
  return createClient({
    apiKey: apiKey(),
    ...(process.env.MYSENDBOX_API_URL ? { baseUrl: process.env.MYSENDBOX_API_URL } : {}),
    ...overrides
  })
}

/** A setting, trimmed; blank is ''. */
export async function setting(key: keyof typeof SETTINGS & string): Promise<string> {
  return (await Settings.get(key))?.trim() || ''
}

/**
 * The site's audience id, making the audience when there is none yet.
 * Throws when MySendbox can't be reached or refuses, which is what callers
 * want: nothing can be synced or sent without it.
 */
export async function audienceId(): Promise<string> {
  const known = await setting('mysendbox_audience_id')
  if (known) return known

  const name = `${(await Settings.getSiteName()) || 'Site'} members`.slice(0, 100)
  const created = await client().createAudience(name)

  let id = created.ok ? created.data?.id : undefined
  if (!created.ok && created.status === 409) {
    // Made by an earlier attempt whose answer was lost: find it by name.
    const listed = await client().listAudiences()
    id = listed.ok ? listed.data?.audiences?.find((a) => a.name === name)?.id : undefined
  }
  if (!id) throw new Error(created.ok ? 'MySendbox did not return an audience id' : `MySendbox refused to make the audience: ${created.error}`)

  await Settings.set('mysendbox_audience_id', id, 'mysendbox')
  return id
}
