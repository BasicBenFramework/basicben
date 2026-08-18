/**
 * Mail templates.
 *
 * `{{token}}` substitution over files in a directory — the same mechanism the
 * scaffolding stubs use. No template engine, because the alternative to one is
 * a dozen lines rather than a dependency.
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

/**
 * Render the text and HTML parts of a named template.
 *
 * Looks for `<dir>/<name>.txt` and `<dir>/<name>.html`; either may be absent.
 *
 * @param {string} name
 * @param {Object} [data] - values for {{placeholders}}
 * @param {string} [dir] - template directory, relative to cwd
 * @returns {{ text?: string, html?: string }}
 */
export function renderMail(name, data = {}, dir = 'mail') {
  const base = resolve(process.cwd(), dir)
  const out = {}

  const text = join(base, `${name}.txt`)
  const html = join(base, `${name}.html`)

  // Escaping applies to the HTML part only — turning & into &amp; in a plain
  // text body would corrupt any URL carrying a query string.
  if (existsSync(text)) out.text = interpolate(readFileSync(text, 'utf8'), data, false)
  if (existsSync(html)) out.html = interpolate(readFileSync(html, 'utf8'), data, true)

  if (!out.text && !out.html) {
    throw new Error(`No mail template named "${name}" in ${dir}/ (expected ${name}.txt or ${name}.html)`)
  }

  return out
}

/**
 * Replace {{key}} with its value.
 *
 * HTML escaping is applied to values substituted into an HTML template, since a
 * name or a subject can come from user input. Use {{{key}}} to opt out where
 * the value is known-safe markup.
 *
 * @param {string} template
 * @param {Object} data
 * @param {boolean} [escape]
 * @returns {string}
 */
export function interpolate(template, data = {}, escape = true) {
  return String(template)
    // Triple braces first, so they are not eaten by the double-brace pass.
    .replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_match, key) => String(lookup(data, key) ?? ''))
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key) => {
      const value = lookup(data, key)
      if (value === undefined || value === null) return ''
      return escape ? escapeHtml(String(value)) : String(value)
    })
}

function lookup(data, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), data)
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
