/**
 * Features' admin pages, placed in the menu. Shared by the server's menu and
 * the client's fallback copy, so the two place them identically.
 *
 * A page goes after the last item in its section; with no such section yet,
 * before the Account section (the profile stays last), or at the end.
 */
import type { FeaturePage } from './manifest.ts'

export interface MenuEntry {
  path: string
  label: string
  icon?: string
  section?: string
  capability?: string
}

export function withFeaturePages<T extends MenuEntry>(menu: T[], manifests: Array<{ pages?: FeaturePage[] }>): T[] {
  const out = [...menu]

  for (const page of manifests.flatMap((manifest) => manifest.pages ?? [])) {
    const entry = { path: page.path, label: page.label, ...(page.icon ? { icon: page.icon } : {}), ...(page.section ? { section: page.section } : {}), ...(page.capability ? { capability: page.capability } : {}) } as T
    let at = -1
    out.forEach((item, index) => { if (item.section === page.section) at = index + 1 })
    if (at === -1) {
      const account = out.findIndex((item) => item.section === 'Account')
      at = account === -1 ? out.length : account
    }
    out.splice(at, 0, entry)
  }

  return out
}
