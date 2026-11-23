/**
 * HTML to Markdown, for imported blog content.
 *
 * This CMS edits Markdown, so everything an importer brings in — WordPress's
 * rendered HTML, a WXR file's raw post content, Ghost's `html` field — has to
 * become Markdown on the way in, or the editor shows raw tags and
 * `?format=markdown` is a lie. It replaces Turndown (and `he`) so the importers
 * stop needing either.
 *
 * ## Scope
 *
 * Good enough for what blogs contain: paragraphs, headings, emphasis, links,
 * images, lists (nested), quotes, code, tables, figures with captions, and
 * embeds. It is not a general HTML parser — it does not build the spec's DOM,
 * only a tree tolerant enough for the markup CMSes emit (unclosed `<p>` and
 * `<li>`, stray closing tags).
 *
 * ## What happens to markup Markdown cannot say
 *
 * This project's Markdown renderer shows raw HTML as text rather than passing
 * it through, so "keep the tag" — Turndown's answer for figures, iframes and
 * tables — would print the tags on the page the first time a post was saved.
 * Instead: tables become GFM tables, figures become their image plus an
 * italic caption, and an embed becomes a link to what it embedded, so a video
 * degrades to a link rather than vanishing. Scripts and styles are dropped
 * whole; any other tag is unwrapped and its text kept.
 */

import { decodeEntities } from '@basicbenframework/core/content'

export { decodeEntities }

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr'
])

/** Removed with everything inside them: their content is not prose. */
const DROP = new Set(['script', 'style', 'noscript', 'template', 'title', 'textarea', 'svg', 'math', 'head', 'button', 'select'])

/** Content of these is raw text up to the closing tag. */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title'])

const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'center', 'dd', 'details',
  'dialog', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer',
  'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'html',
  'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody',
  'td', 'tfoot', 'th', 'thead', 'tr', 'ul', 'iframe', 'video', 'audio', 'object',
  'embed', 'caption'
])

/** Opening one of these closes an open `<p>`, as browsers do. */
const CLOSES_P = new Set([...BLOCK].filter((t) => !['li', 'dd', 'dt', 'td', 'th', 'tr', 'tbody', 'thead', 'tfoot', 'caption', 'figcaption', 'summary', 'iframe', 'video', 'audio', 'object', 'embed'].includes(t)))

const EMBEDS = new Set(['iframe', 'video', 'audio', 'object', 'embed'])

/** Hard line break, held as a sentinel until whitespace has been collapsed. */
const BR = '\u0001'

/**
 * Parse an HTML fragment into `{ name, attrs, children }` elements and string
 * text nodes. Entities are decoded in text and attribute values.
 */
export function parseHtml(html) {
  const src = String(html ?? '').replace(/\0/g, '')
  const root = { name: '#root', attrs: {}, children: [] }
  const stack = [root]
  let i = 0

  const top = () => stack[stack.length - 1]
  const text = (value) => {
    if (!value) return
    const kids = top().children
    if (typeof kids[kids.length - 1] === 'string') kids[kids.length - 1] += value
    else kids.push(value)
  }
  const closeUntil = (name) => {
    for (let d = stack.length - 1; d > 0; d--) {
      if (stack[d].name === name) {
        stack.length = d
        return true
      }
    }
    return false
  }

  while (i < src.length) {
    const lt = src.indexOf('<', i)

    if (lt === -1) {
      text(decodeEntities(src.slice(i)))
      break
    }

    if (lt > i) text(decodeEntities(src.slice(i, lt)))

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4)
      i = end === -1 ? src.length : end + 3
      continue
    }

    if (src[lt + 1] === '!' || src[lt + 1] === '?') {
      const end = src.indexOf('>', lt)
      i = end === -1 ? src.length : end + 1
      continue
    }

    const closing = src[lt + 1] === '/'
    const match = /^<\/?([A-Za-z][A-Za-z0-9:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/.exec(src.slice(lt, lt + 8192))

    if (!match) {
      // A lone `<` in prose ("a < b"), not a tag.
      text('<')
      i = lt + 1
      continue
    }

    const name = match[1].toLowerCase()
    i = lt + match[0].length

    if (closing) {
      if (name === 'p' && !stack.some((el) => el.name === 'p')) {
        // `</p>` with nothing open is an empty paragraph to a browser.
        continue
      }
      closeUntil(name)
      continue
    }

    const attrs = {}
    for (const a of match[2].matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '')
    }

    // The implied end tags real markup relies on.
    if (CLOSES_P.has(name) && top().name === 'p') stack.pop()
    if (name === 'li') closeSibling(stack, 'li', ['ul', 'ol'])
    if (name === 'dt' || name === 'dd') closeSibling(stack, ['dt', 'dd'], ['dl'])
    if (name === 'tr') closeSibling(stack, 'tr', ['table', 'thead', 'tbody', 'tfoot'])
    if (name === 'td' || name === 'th') closeSibling(stack, ['td', 'th'], ['tr', 'table'])
    if (name === 'p' && top().name === 'p') stack.pop()

    const element = { name, attrs, children: [] }
    top().children.push(element)

    if (RAW_TEXT.has(name)) {
      const end = src.toLowerCase().indexOf(`</${name}`, i)
      const stop = end === -1 ? src.length : end
      element.children.push(src.slice(i, stop))
      const gt = src.indexOf('>', stop)
      i = gt === -1 ? src.length : gt + 1
      continue
    }

    if (!VOID.has(name) && !match[3]) stack.push(element)
  }

  return root
}

/** Close an open `names` element, but not past its container. */
function closeSibling(stack, names, containers) {
  const wanted = Array.isArray(names) ? names : [names]
  for (let d = stack.length - 1; d > 0; d--) {
    if (containers.includes(stack[d].name)) return
    if (wanted.includes(stack[d].name)) {
      stack.length = d
      return
    }
  }
}

/** The plain text of a node. */
export function textContent(node) {
  if (typeof node === 'string') return node
  if (DROP.has(node.name)) return ''
  if (node.name === 'br') return '\n'
  return node.children.map(textContent).join('')
}

/**
 * Convert HTML to Markdown.
 *
 * @param {string} html
 * @returns {string}
 */
export function htmlToMarkdown(html) {
  const tree = parseHtml(html)
  return blocks(tree.children)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Render children as a list of Markdown blocks. */
function blocks(children) {
  const out = []
  let run = []

  const flush = () => {
    const paragraph = escapeLineStart(inlines(run))
    if (paragraph) out.push(paragraph)
    run = []
  }

  for (const node of children) {
    if (typeof node === 'string' || !BLOCK.has(node.name)) {
      run.push(node)
    } else {
      flush()
      out.push(...block(node))
    }
  }

  flush()
  return out
}

function block(el) {
  const { name } = el

  if (DROP.has(name)) return []

  if (/^h[1-6]$/.test(name)) {
    const text = inlines(el.children).replace(new RegExp(BR, 'g'), ' ').replace(/\\\n/g, ' ').trim()
    return text ? [`${'#'.repeat(Number(name[1]))} ${text}`] : []
  }

  switch (name) {
    case 'hr':
      return ['---']

    case 'pre':
      return [codeBlock(el)]

    case 'blockquote': {
      const inner = blocks(el.children).join('\n\n')
      if (!inner) return []
      return [inner.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n')]
    }

    case 'ul':
    case 'ol':
      return [list(el)].filter(Boolean)

    case 'table':
      return table(el)

    case 'figcaption': {
      const caption = inlines(el.children)
      return caption ? [`*${caption}*`] : []
    }

    case 'dt': {
      const term = inlines(el.children)
      return term ? [`**${term}**`] : []
    }

    case 'iframe':
    case 'video':
    case 'audio':
    case 'object':
    case 'embed':
      return [embed(el)].filter(Boolean)

    default:
      return blocks(el.children)
  }
}

function codeBlock(el) {
  const code = el.children.find((c) => typeof c !== 'string' && c.name === 'code')
  const className = `${el.attrs.class ?? ''} ${code?.attrs.class ?? ''}`
  const language = /(?:^|\s)(?:language|lang)-([\w+#.-]+)/.exec(className)?.[1] ?? ''
  const text = textContent(el).replace(/^\n/, '').replace(/\s+$/, '')
  // A fence longer than any run of backticks inside, so the code cannot close it.
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}${language}\n${text}\n${fence}`
}

function list(el) {
  const ordered = el.name === 'ol'
  let n = Number.parseInt(el.attrs.start ?? '1', 10)
  if (!Number.isFinite(n)) n = 1

  const items = []

  for (const node of el.children) {
    if (typeof node === 'string') {
      if (node.trim()) items.push(escapeLineStart(inlines([node])))
      continue
    }

    const content = joinItemBlocks(node.name === 'li' ? blocks(node.children) : block(node))
    const marker = ordered ? `${n++}. ` : '- '
    const indent = ' '.repeat(marker.length)
    const [first = '', ...rest] = content.split('\n')

    items.push(marker + first + rest.map((line) => `\n${line ? indent + line : ''}`).join(''))
  }

  return items.join('\n')
}

/**
 * Blocks inside one list item. A nested list follows its parent's text on
 * the next line, so `- two` and its sub-list stay one tight item; anything
 * else is separated by a blank line, as Markdown needs for a second paragraph.
 */
function joinItemBlocks(parts) {
  return parts.reduce((out, part) => {
    if (!out) return part
    return out + (/^(?:[-+*]|\d+[.)]) /.test(part) ? '\n' : '\n\n') + part
  }, '')
}

/** A GFM table, or the cells as paragraphs if it has no recognisable rows. */
function table(el) {
  const rows = []

  const walk = (node, inHead) => {
    for (const c of node.children) {
      if (typeof c === 'string') continue
      if (c.name === 'tr') rows.push({ head: inHead || c.children.some((x) => typeof x !== 'string' && x.name === 'th') && rows.length === 0, cells: c.children.filter((x) => typeof x !== 'string' && (x.name === 'td' || x.name === 'th')) })
      else if (c.name === 'thead') walk(c, true)
      else if (c.name === 'tbody' || c.name === 'tfoot') walk(c, false)
    }
  }

  walk(el, false)

  if (rows.length === 0) return blocks(el.children)

  const cell = (c) => inlines(c.children).replace(new RegExp(BR, 'g'), ' ').replace(/\\\n/g, ' ').trim()
  const width = Math.max(...rows.map((r) => r.cells.length))
  const line = (cells) => `| ${Array.from({ length: width }, (_, k) => cells[k] ?? '').join(' | ')} |`

  const header = rows[0].head ? rows.shift().cells.map(cell) : Array.from({ length: width }, () => '')
  const caption = el.children.find((c) => typeof c !== 'string' && c.name === 'caption')

  const out = [
    line(header),
    `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
    ...rows.map((r) => line(r.cells.map(cell)))
  ].join('\n')

  return caption ? [`*${inlines(caption.children)}*`, out] : [out]
}

function embed(el) {
  const source = el.children.find((c) => typeof c !== 'string' && c.name === 'source')
  const src = el.attrs.src || el.attrs.data || source?.attrs.src
  if (!src || !safeUrl(src)) return ''
  const label = el.attrs.title || (el.name === 'video' ? 'Video' : el.name === 'audio' ? 'Audio' : 'Embedded content')
  return `[${escapeText(label)}](${destination(src)})`
}

/** Render inline nodes to one paragraph of Markdown. */
function inlines(nodes) {
  return nodes
    .map(inline)
    .join('')
    .replace(/[ \t\n\r\f]+/g, ' ')
    .replace(new RegExp(` ?${BR} ?`, 'g'), BR)
    .trim()
    .replace(new RegExp(`^${BR}+|${BR}+$`, 'g'), '')
    .replace(new RegExp(BR, 'g'), '\\\n')
}

function inline(node) {
  if (typeof node === 'string') return escapeText(node)

  const { name, attrs, children } = node

  if (DROP.has(name)) return ''

  switch (name) {
    case 'br':
      return BR

    case 'strong':
    case 'b':
      return wrap(children, '**')

    case 'em':
    case 'i':
    case 'cite':
      return wrap(children, '*')

    case 'del':
    case 's':
    case 'strike':
      return wrap(children, '~~')

    case 'code':
    case 'kbd':
    case 'samp':
    case 'tt': {
      const text = textContent(node).replace(/\s+/g, ' ')
      if (!text.trim()) return text
      const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length))
      const ticks = '`'.repeat(longest + 1)
      const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
      return `${ticks}${pad}${text}${pad}${ticks}`
    }

    case 'a': {
      const content = children.map(inline).join('')
      const href = attrs.href?.trim()
      if (!href || href.startsWith('#') && content.trim() === '' || !safeUrl(href)) return content
      if (!content.trim()) return ''
      const title = attrs.title ? ` "${attrs.title.replace(/"/g, '\\"')}"` : ''
      return `[${content.trim()}](${destination(href)}${title})`
    }

    case 'img': {
      const src = attrs.src?.trim()
      if (!src || !safeUrl(src)) return ''
      const alt = (attrs.alt ?? '').replace(/[[\]\\]/g, '\\$&')
      const title = attrs.title ? ` "${attrs.title.replace(/"/g, '\\"')}"` : ''
      return `![${alt}](${destination(src)}${title})`
    }

    case 'input':
      return attrs.type === 'checkbox' ? ('checked' in attrs ? '[x] ' : '[ ] ') : ''

    default:
      if (EMBEDS.has(name)) return ` ${embed(node)} `
      // A block element reached inside inline content (a <div> in a link,
      // say) cannot be a block here; its content stays inline.
      return children.map(inline).join('')
  }
}

/** Emphasis around content, with surrounding whitespace moved outside. */
function wrap(children, delimiter) {
  const content = children.map(inline).join('')
  if (!content.trim()) return content
  const lead = /^\s*/.exec(content)[0]
  const trail = /\s*$/.exec(content)[0]
  return `${lead}${delimiter}${content.trim()}${delimiter}${trail}`
}

/** Escape characters that would otherwise become Markdown syntax. */
function escapeText(text) {
  return text
    .replace(/[\\`*_[\]<>~|]/g, '\\$&')
    // An entity-shaped run would be decoded by the renderer; the text meant it literally.
    .replace(/&(?=#?[A-Za-z0-9]+;)/g, '\\&')
}

/** Text that starts a line looking like a heading, list item or quote. */
function escapeLineStart(paragraph) {
  return paragraph
    .split('\n')
    .map((line) => line
      .replace(/^(#{1,6})(\s|$)/, '\\$1$2')
      .replace(/^([-+])(\s)/, '\\$1$2')
      .replace(/^(\d+)([.)])(\s)/, '$1\\$2$3')
      .replace(/^(=+|-+)$/, '\\$1'))
    .join('\n')
}

function destination(url) {
  return url.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')
}

/**
 * Drop `javascript:` and friends. The sanitizer would remove them from the
 * rendered HTML anyway; leaving them out of the Markdown means the source
 * never carries one either.
 */
function safeUrl(url) {
  const cleaned = String(url).replace(/[\u0000- \u007f]/g, '').toLowerCase()
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(cleaned)?.[1]
  return !scheme || ['http', 'https', 'mailto', 'tel', 'ftp'].includes(scheme)
}

/**
 * WordPress's `wpautop`, roughly: turn the blank-line-separated text that
 * classic-editor posts are stored as into paragraphs.
 *
 * A WXR file holds `post_content` as the author saved it, not as the site
 * rendered it — WordPress adds the `<p>` tags at display time. Without this a
 * classic post's paragraphs all run together. Block-editor content is already
 * real HTML (every paragraph is a `<p>` between `<!-- wp:` comments), so it is
 * left alone.
 *
 * @param {string} content
 * @returns {string}
 */
export function autop(content) {
  const text = String(content ?? '').replace(/\r\n?/g, '\n')
  if (!text.trim() || /<!--\s*wp:/.test(text)) return text

  // Preformatted blocks keep their newlines.
  const preserved = []
  const protectedText = text.replace(/<pre[\s>][\s\S]*?<\/pre>/gi, (m) => {
    preserved.push(m)
    return `\u0002${preserved.length - 1}\u0002`
  })

  const blockStart = /^\s*(<\/?(?:p|div|h[1-6]|ul|ol|li|blockquote|pre|table|thead|tbody|tr|td|th|figure|figcaption|hr|section|article|aside|header|footer|iframe|dl|dt|dd|form|address|video|audio)\b|\u0002)/i

  return protectedText
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => (blockStart.test(chunk) ? chunk : `<p>${chunk.replace(/\n/g, '<br />\n')}</p>`))
    .join('\n')
    .replace(/\u0002(\d+)\u0002/g, (_, k) => preserved[Number(k)])
}

/**
 * Unwrap the shortcodes that carry content, leaving the rest as text.
 *
 * `[caption]` wraps nearly every captioned image a classic WordPress post
 * has; left alone it prints as literal brackets around the picture. It
 * becomes a figure, so the caption survives. `[embed]` becomes a link. Other
 * shortcodes belong to plugins that will not exist here, and are left visible
 * so an editor can see something needs replacing rather than having it
 * silently vanish.
 *
 * @param {string} content
 * @returns {string}
 */
export function expandShortcodes(content) {
  return String(content ?? '')
    .replace(/\[caption[^\]]*\]([\s\S]*?)\[\/caption\]/gi, (_, inner) => {
      const m = /^(\s*(?:<a\b[^>]*>\s*)?<img\b[^>]*>(?:\s*<\/a>)?)([\s\S]*)$/i.exec(inner)
      return m ? `<figure>${m[1]}<figcaption>${m[2].trim()}</figcaption></figure>` : inner
    })
    .replace(/\[embed[^\]]*\]\s*(https?:\/\/[^\s[]+)\s*\[\/embed\]/gi, '<p><a href="$1">$1</a></p>')
}

/**
 * The plain-text summary for an excerpt field: tags stripped, entities
 * decoded, whitespace collapsed, WordPress's `[&hellip;]` read as "...".
 */
export function plainText(html) {
  return decodeEntities(
    String(html ?? '')
      .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      // Block boundaries separate words; inline tags (`<em>`) must not, or
      // "a <em>soup</em>." reads "a soup ."
      .replace(/<\/?(p|div|br|li|h[1-6]|blockquote|tr|td|th)\b[^>]*>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\[&hellip;\]|\[…\]/g, '...')
  )
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * A comment as the plain text this CMS stores comments as.
 *
 * Comments are not Markdown here — they are shown as text — so Markdown
 * escaping would put backslashes in front of every asterisk a reader typed.
 * Paragraph and line breaks are kept; every tag is dropped.
 */
export function commentText(html) {
  return decodeEntities(
    autop(String(html ?? ''))
      .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<br\s*\/?>\s*/gi, '\n')
      .replace(/<\/(p|div|blockquote|li|h[1-6])>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
  )
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
