/**
 * Content pipeline.
 *
 * Markdown in, sanitized HTML out, with a filter hook in between for plugins.
 *
 * ## Where rendering happens
 *
 * At save time, not read time. A blog is read far more often than it is
 * written, so rendering once per save rather than once per request is the
 * cheaper side of the trade — and it serves the headless case, where a consumer
 * can ask for the Markdown source or the rendered HTML depending on whether it
 * does its own rendering.
 *
 * The cost is that changing the parser or the allowlist leaves stored HTML
 * stale. `basicben content:rerender` exists to pay it.
 *
 * ## Markdown is canonical
 *
 * `content` holds the Markdown and is the source of truth. `content_html` is a
 * cache that can be rebuilt from it at any time and should never be edited
 * directly. A blog ought to outlive the CMS that published it, and Markdown is
 * what makes that possible.
 *
 * ## Order of operations
 *
 * Parse, then filter, then sanitize — in that order, and the order is the
 * point. Sanitization runs last and unconditionally, so no plugin can put
 * markup on the page that the allowlist has not seen. A plugin adding syntax
 * highlighting or lazy-loaded images works because those tags and attributes
 * are allowed, not because it is trusted.
 */

import { renderMarkdown, defaultSlugify } from './markdown.js'
import { sanitizeHtml, stripTags } from './sanitize.js'
import { hooks, HOOKS } from '../hooks/index.js'

export { renderMarkdown } from './markdown.js'
export {
  sanitizeHtml,
  stripTags,
  escapeHtml,
  decodeEntities,
  isSafeUrl,
  DEFAULT_ALLOWED,
  DEFAULT_ALLOWED_SCHEMES
} from './sanitize.js'

/**
 * Render Markdown into HTML that is safe to place in the document.
 *
 * @param {string} source - Markdown
 * @param {Object} [options]
 * @param {Object} [options.context] - passed to the `content.render` filter
 * @param {string[]} [options.schemes] - URL schemes permitted in links
 * @param {Object} [options.allowed] - sanitizer allowlist override
 * @param {boolean} [options.headingIds] - add ids to headings (default true)
 * @param {boolean} [options.filter] - run the `content.render` hook (default true)
 * @returns {Promise<string>} sanitized HTML
 */
export async function renderContent(source, options = {}) {
  const html = renderMarkdown(source, {
    schemes: options.schemes,
    headingIds: options.headingIds,
    slugify: options.slugify
  })

  const filtered = options.filter === false
    ? html
    : await hooks.filter(HOOKS.CONTENT_RENDER, html, options.context || {})

  // Last, and always. A plugin that returned something unexpected — or nothing
  // at all — cannot put markup on the page from here.
  return sanitizeHtml(typeof filtered === 'string' ? filtered : html, {
    allowed: options.allowed,
    schemes: options.schemes,
    allowDataImages: options.allowDataImages
  })
}

/**
 * Synchronous render, without the plugin filter.
 *
 * The editor's preview uses this: it runs in the browser, where the plugin
 * hooks do not exist, and it must produce exactly what the server would produce
 * minus that one step — otherwise the preview is a lie.
 *
 * @param {string} source
 * @param {Object} [options]
 * @returns {string} sanitized HTML
 */
export function renderContentSync(source, options = {}) {
  const html = renderMarkdown(source, {
    schemes: options.schemes,
    headingIds: options.headingIds,
    slugify: options.slugify
  })

  return sanitizeHtml(html, {
    allowed: options.allowed,
    schemes: options.schemes,
    allowDataImages: options.allowDataImages
  })
}

/**
 * A plain-text summary, for meta descriptions and post listings.
 *
 * Built from the Markdown rather than the HTML so that markup never leaks into
 * a `<meta>` tag, and cut at a word boundary so the result does not end
 * mid-word.
 *
 * @param {string} source - Markdown
 * @param {number} [length] - maximum characters
 * @returns {string}
 */
export function excerpt(source, length = 200) {
  if (!source) return ''

  const text = stripTags(renderMarkdown(String(source), { headingIds: false }))

  if (text.length <= length) return text

  const cut = text.slice(0, length)
  const lastSpace = cut.lastIndexOf(' ')

  return `${(lastSpace > length * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/**
 * Turn a title into a URL slug.
 *
 * @param {string} text
 * @returns {string}
 */
export function slugify(text) {
  return defaultSlugify(text)
}

/**
 * Read the headings out of a document, for a table of contents.
 *
 * Uses the same slug function the renderer does, so the returned ids match the
 * anchors actually present in the HTML.
 *
 * @param {string} source - Markdown
 * @param {Object} [options]
 * @returns {Array<{level: number, text: string, id: string}>}
 */
export function headings(source, options = {}) {
  if (!source) return []

  const slug = options.slugify || defaultSlugify
  const used = new Set()
  const found = []

  let inFence = null

  for (const rawLine of String(source).replace(/\r\n?/g, '\n').split('\n')) {
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(rawLine)
    if (fence) {
      if (inFence && rawLine.trim().startsWith(inFence)) inFence = null
      else if (!inFence) inFence = fence[1][0].repeat(3)
      continue
    }

    // A '#' inside a code block is not a heading.
    if (inFence) continue

    const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(rawLine)
    if (!atx) continue

    const text = (atx[2] || '').trim()
    if (!text) continue

    const base = slug(text.replace(/[*_`~]/g, ''))
    let id = base
    let n = 2
    while (used.has(id)) id = `${base}-${n++}`
    used.add(id)

    found.push({ level: atx[1].length, text, id })
  }

  return found
}
