import { useEffect, useState } from 'react'

/**
 * The site's identity, for the CMS's own screens: the sign-in pages, the
 * admin's sidebar and the browser tab. From `GET /api/site`, asked once per
 * page load and shared by every caller; `refreshSite()` asks again (after
 * Settings is saved).
 */
export interface SiteBrand {
  site_name: string
  site_description: string
  logo_url: string | null
  icon_url: string | null
  /** #rrggbb, or null for the built-in colours. */
  accent_color: string | null
  login_tagline: string | null
  registration_open: boolean
}

let pending: Promise<SiteBrand | null> | null = null
const listeners = new Set<(site: SiteBrand | null) => void>()

function fetchSite(): Promise<SiteBrand | null> {
  pending ??= fetch('/api/site', { headers: { Accept: 'application/json' } })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)
  return pending
}

export function refreshSite(): void {
  pending = null
  fetchSite().then((site) => listeners.forEach((listener) => listener(site)))
}

export function useSite(): SiteBrand | null {
  const [site, setSite] = useState<SiteBrand | null>(null)

  useEffect(() => {
    let live = true
    const listener = (next: SiteBrand | null) => live && setSite(next)
    listeners.add(listener)
    fetchSite().then(listener)
    return () => {
      live = false
      listeners.delete(listener)
    }
  }, [])

  return site
}

/**
 * The text colour that reads on `hex`: near-black on light colours, white on
 * dark ones (WCAG relative luminance, split where the two contrasts meet).
 */
export function readableOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.179 ? '#111111' : '#ffffff'
}

/** CSS variables for the accent, or none when the site has not set one. */
export function accentVars(site: SiteBrand | null): Record<string, string> {
  const accent = site?.accent_color
  if (!accent || !/^#[0-9a-f]{6}$/i.test(accent)) return {}
  return { '--accent': accent, '--accent-fg': readableOn(accent) }
}

const DEFAULT_TITLE = 'BasicBen App'

/**
 * The browser tab: the site's name in place of the template's title, and its
 * icon as the favicon. A page that sets its own title is left alone.
 */
export function useBrandDocument(site: SiteBrand | null): void {
  useEffect(() => {
    if (!site) return
    if (site.site_name && (document.title === DEFAULT_TITLE || document.title === '')) document.title = site.site_name
    if (site.icon_url) {
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
      if (!link) {
        link = document.createElement('link')
        link.rel = 'icon'
        document.head.appendChild(link)
      }
      link.removeAttribute('type')
      link.href = site.icon_url
    }
  }, [site?.site_name, site?.icon_url])
}
