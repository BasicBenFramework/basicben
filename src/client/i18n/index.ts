/**
 * Admin translations.
 *
 * Keyed on the English text itself, gettext-style: `t('Save changes')`. The
 * English string is the fallback, so a missing translation shows English
 * rather than a key like `posts.save_button`, and a component reads the same
 * as it did before it was translated. `tests/admin-i18n.test.js` reads every
 * `t()`/`tn()` literal in the admin and notes what each locale lacks (fails on
 * it with I18N_STRICT=1).
 *
 * ## Which language
 *
 * 1. This browser's choice (Profile → Admin language), kept in localStorage.
 * 2. The site's `admin_locale` setting, which `/api/admin/menu` reports.
 * 3. English.
 *
 * A locale is matched on its full tag and then on its language alone, so
 * `es-MX` gets the `es` dictionary. Dictionaries are loaded on demand: an
 * English admin downloads none of them.
 *
 * ## Interpolation and plurals
 *
 * `t('Deleted {name}', { name })` — values are inserted as text; React
 * escapes them like any other string, so there is no markup channel here.
 * `tn('{count} post', '{count} posts', n)` picks the form with
 * `Intl.PluralRules`, so languages with more than two forms can supply them.
 */

import { createElement, Fragment, useSyncExternalStore, type ReactNode } from 'react'

export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }
export type Dictionary = Record<string, string | PluralForms>
type Vars = Record<string, string | number>

/** Locales with a dictionary, and the name each calls itself in the picker. */
export const ADMIN_LOCALES: Array<{ code: string; name: string }> = [
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'pt', name: 'Português (Brasil)' },
  { code: 'ja', name: '日本語' },
  // Simplified. zh-TW and zh-HK fall back to it too, until there is a zh-Hant.
  { code: 'zh', name: '简体中文' }
]

const OVERRIDE_KEY = 'basicben.admin_locale'

// Vite turns this into one lazily loaded chunk per locale. `.ts` matches the
// source here; `.js` matches the compiled copy in lib/, which tsc does not
// rewrite inside a string. `index.d.ts` matches neither.
const loaders = import.meta.glob<{ default: Dictionary }>('./locales/*/index.{ts,js}')

// Features' dictionaries (src/client/host), per locale, merged over core's.
const featureLoaders: Record<string, Array<() => Promise<{ default: Dictionary }>>> = {}

let locale = 'en'
let dictionary: Dictionary = {}
let version = 0
const listeners = new Set<() => void>()

function notify() {
  version++
  for (const listener of listeners) listener()
}

/** The full tag, then the language alone, among the shipped locales. */
export function resolveLocale(requested: string | null | undefined): string {
  if (!requested) return 'en'
  const codes = ADMIN_LOCALES.map((entry) => entry.code)
  if (codes.includes(requested)) return requested
  const language = requested.split('-')[0].toLowerCase()
  return codes.includes(language) ? language : 'en'
}

export function currentLocale(): string {
  return locale
}

/** This browser's choice, or null to follow the site. */
export function localeOverride(): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(OVERRIDE_KEY)
}

export async function setLocale(requested: string | null | undefined): Promise<void> {
  const next = resolveLocale(requested)
  if (next === locale && (next === 'en' || Object.keys(dictionary).length)) return

  if (next === 'en') {
    dictionary = {}
  } else {
    const load = loaders[`./locales/${next}/index.ts`] ?? loaders[`./locales/${next}/index.js`]
    if (!load) return
    try {
      const core = await load()
      // Read after the await: features register while core's chunk loads, and
      // one registered by then must not be missed.
      const extra = await Promise.all((featureLoaders[next] ?? []).map((loader) => loader()))
      dictionary = Object.assign({}, core.default, ...extra.map((module) => module.default))
    } catch {
      // A chunk that fails to load leaves the admin in English, not blank.
      return
    }
  }

  locale = next
  if (typeof document !== 'undefined') document.documentElement.lang = next
  notify()
}

/**
 * A feature's translations. If the admin is already showing that language,
 * they are loaded and applied now, so registration order does not matter.
 */
export function addDictionaries(map: Record<string, () => Promise<{ default: Dictionary }>>): void {
  for (const [code, loader] of Object.entries(map)) {
    featureLoaders[code] = [...(featureLoaders[code] ?? []), loader]

    if (code === locale) {
      loader()
        .then((module) => {
          dictionary = { ...dictionary, ...module.default }
          notify()
        })
        .catch(() => {})
    }
  }
}

/** Remember (or with null, forget) this browser's choice, and apply it. */
export async function chooseLocale(code: string | null, siteLocale?: string | null): Promise<void> {
  if (typeof localStorage !== 'undefined') {
    if (code) localStorage.setItem(OVERRIDE_KEY, code)
    else localStorage.removeItem(OVERRIDE_KEY)
  }
  await setLocale(code ?? siteLocale ?? 'en')
}

/** Called with the site's setting once it is known. The browser's choice wins. */
export function applySiteLocale(siteLocale: string | null | undefined): Promise<void> {
  return setLocale(localeOverride() ?? siteLocale ?? 'en')
}

function fill(text: string, vars?: Vars): string {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  )
}

/** Translate a fixed English string. */
export function t(source: string, vars?: Vars): string {
  const entry = dictionary[source]
  return fill(typeof entry === 'string' && entry ? entry : source, vars)
}

/** Translate a count. `{count}` is filled in for you. */
export function tn(one: string, other: string, count: number, vars?: Vars): string {
  const all = { count: count.toLocaleString(locale), ...vars }
  const entry = dictionary[pluralKey(one, other)]

  if (entry && typeof entry === 'object') {
    const form = new Intl.PluralRules(locale).select(count)
    return fill(entry[form] ?? entry.other, all)
  }

  return fill(count === 1 ? one : other, all)
}

/**
 * A translated sentence with elements in its `{name}` slots:
 * `slots(t('Entries live at {code}.'), { code: <code>/recipes</code> })`.
 *
 * For markup inside a sentence. The sentence stays one string, so a
 * translation can move the element to wherever its grammar puts it. A slot
 * with no element is left as written, so a typo shows rather than vanishing.
 */
export function slots(text: string, parts: Record<string, ReactNode>): ReactNode[] {
  return text.split(/\{(\w+)\}/g).map((piece, index) =>
    index % 2 ? createElement(Fragment, { key: index }, parts[piece] ?? `{${piece}}`) : piece
  )
}

/** How a plural pair is keyed in a dictionary. */
export function pluralKey(one: string, other: string): string {
  return `${one}|${other}`
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * `t` and `tn`, re-rendering the component when the language changes.
 * Components use this; plain helpers call `t` directly.
 */
export function useT() {
  useSyncExternalStore(subscribe, () => version, () => version)
  return { t, tn, locale }
}

// Start loading the browser's own choice at once rather than after the menu
// request, so the English frame before it is as short as it can be.
if (typeof window !== 'undefined') void setLocale(localeOverride())
