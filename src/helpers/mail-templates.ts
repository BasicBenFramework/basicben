/**
 * Mail templates: the site's own first, then the CMS's.
 *
 * A site overrides one template by putting a file of the same name in its
 * mail/ directory. The lookup is per file, so it can replace the HTML part
 * alone and keep the CMS's text part. Everything it does not override comes
 * from the CMS's mail/, found beside src/ in the repository and beside lib/
 * in the package.
 *
 * Core's renderMail reads one directory; this calls it for each.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderMail as renderFrom } from '@basicbenframework/core/mail'

/** The CMS's templates. A URL Vercel's tracer follows into the function. */
export const CMS_MAIL = fileURLToPath(new URL('../../mail/', import.meta.url))

/** The site's overrides, relative to where the site runs. */
export const SITE_MAIL = 'mail'

type Parts = { text?: string; html?: string }

function partsIn(dir: string, name: string, data: Record<string, unknown>): Parts {
  const has = (ext: string) => existsSync(resolve(process.cwd(), dir, `${name}.${ext}`))
  if (!has('txt') && !has('html')) return {}
  return renderFrom(name, data, dir)
}

/** Render a template's text and HTML parts. Throws when neither directory has it. */
export function renderMail(name: string, data: Record<string, unknown> = {}): Parts {
  const site = resolve(process.cwd(), SITE_MAIL)
  const own = site === resolve(CMS_MAIL) ? {} : partsIn(SITE_MAIL, name, data)
  const cms = partsIn(CMS_MAIL, name, data)
  const out: Parts = {}
  const text = own.text ?? cms.text
  const html = own.html ?? cms.html
  if (text !== undefined) out.text = text
  if (html !== undefined) out.html = html
  if (!out.text && !out.html) {
    throw new Error(`No mail template named "${name}" in the site's mail/ or the CMS's (expected ${name}.txt or ${name}.html)`)
  }
  return out
}
