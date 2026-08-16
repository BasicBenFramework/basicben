/**
 * HTML sanitization.
 *
 * The Markdown parser in this directory is safe by construction — it escapes
 * everything it reads and only emits tags from its own vocabulary — so for
 * parser output this is defence in depth rather than the primary control.
 *
 * It is the *primary* control for anything else: content imported from
 * WordPress, a plugin that post-processes rendered HTML through the
 * `content.render` filter, or a field an operator has deliberately opened up to
 * raw HTML. Those paths carry attacker-influenced markup, and this is what
 * stands between them and `dangerouslySetInnerHTML`.
 *
 * ## Allowlist, never blocklist
 *
 * Blocklists lose. There is always another tag, another event handler, another
 * encoding. Anything not explicitly named here is removed.
 *
 * ## Unwrap, don't delete
 *
 * A disallowed tag has its markup dropped but its text kept, so a stray
 * `<span>` costs a span and not a sentence. The exception is elements whose
 * content is not prose — script, style, and friends — which are removed whole.
 */

/** Tags kept, mapped to the attributes each may carry. */
export const DEFAULT_ALLOWED = {
  p: [],
  br: [],
  hr: [],
  h1: ['id'], h2: ['id'], h3: ['id'], h4: ['id'], h5: ['id'], h6: ['id'],
  em: [], strong: [], del: [], s: [], sub: [], sup: [],
  blockquote: [],
  ul: [], ol: ['start'], li: [],
  dl: [], dt: [], dd: [],
  pre: [], code: ['class'],
  a: ['href', 'title', 'rel', 'target', 'name', 'id'],
  img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'srcset', 'sizes'],
  figure: [], figcaption: [],
  table: [], thead: [], tbody: [], tfoot: [],
  tr: [], th: ['align', 'colspan', 'rowspan', 'scope'], td: ['align', 'colspan', 'rowspan'],
  span: ['class'], div: ['class'],
  input: ['type', 'checked', 'disabled']
}

/**
 * Elements removed along with everything inside them.
 *
 * Unwrapping these would be worse than useless: the body of a `<script>` is
 * code, and turning it into visible text just prints the payload on the page.
 * `<svg>` and `<math>` are here for a subtler reason — they switch the HTML
 * parser into a foreign content mode where `<style>` and friends nest
 * differently, which is the ground mutation-XSS is grown in.
 */
const VOID_CONTENT = new Set([
  'script', 'style', 'template', 'noscript', 'title', 'textarea',
  'iframe', 'object', 'embed', 'applet', 'frame', 'frameset',
  'svg', 'math', 'xmp', 'plaintext', 'listing'
])

/** Tags with no closing tag. */
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'
])

/** Attributes whose value is a URL, and so needs its scheme checked. */
const URL_ATTRIBUTES = new Set(['href', 'src', 'srcset', 'action', 'formaction', 'poster', 'cite', 'background'])

/** Schemes permitted in a URL attribute. */
export const DEFAULT_ALLOWED_SCHEMES = ['http', 'https', 'mailto', 'tel', 'ftp']

/**
 * Decide whether a URL is safe to emit.
 *
 * Two things make this harder than a prefix check.
 *
 * Browsers ignore characters that a naive parser does not. A leading newline,
 * tab, or NUL inside the scheme is stripped before the URL is resolved, so
 * `java\0script:` and `java\tscript:` both navigate. They are removed here
 * before anything is compared.
 *
 * HTML entities are decoded by the parser *after* this runs, so a scheme can be
 * hidden as `&#x6A;avascript:` and reassemble itself downstream. Callers decode
 * entities before calling this; the check below is the second line, catching a
 * scheme that only becomes one after decoding.
 *
 * @param {string} url
 * @param {string[]} [schemes]
 * @returns {boolean}
 */
export function isSafeUrl(url, schemes = DEFAULT_ALLOWED_SCHEMES) {
  if (typeof url !== 'string') return false

  // Characters a browser discards while resolving a URL. Leaving them in
  // would let "java\nscript:x" pass a comparison that "javascript:x" fails.
  const cleaned = url.replace(/[\u0000-\u0020\u007f-\u00a0\u2000-\u200f\u2028-\u202f\u3000\ufeff]/g, '')

  if (cleaned === '') return true

  // A scheme has a grammar — a letter followed by letters, digits, +, - or .
  // Matching it precisely, rather than taking everything before the first
  // colon, is what keeps a relative URL like "foo):bar" from being read as a
  // scheme named "foo)" and refused. Anything that does not match this is not
  // a scheme, and a URL without a scheme is relative and therefore safe.
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(cleaned)
  if (!scheme) return true

  return schemes.includes(scheme[1].toLowerCase())
}

/**
 * Escape text for HTML.
 *
 * Quotes are escaped too, which matters for attribute values, and a bare `'`
 * is escaped because unquoted attributes exist in the wild.
 *
 * @param {string} text
 * @returns {string}
 */
export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Named HTML entities.
 *
 * HTML5 defines about 2,100 of these. Shipping the full table would add tens of
 * kilobytes to a framework whose whole premise is that it adds nothing, in order
 * to decode names like `&DifferentialD;` that no blog post contains. What is
 * here is the markup-critical set, the typographic characters an editor emits,
 * and the whole Latin-1 range — that last part being the one that genuinely
 * matters, since it is how European text gets written when the author's keyboard
 * will not produce it directly.
 *
 * A name outside this table is left as literal text rather than guessed at.
 */
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: '\u00a0', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009',
  zwnj: '\u200c', zwj: '\u200d', shy: '\u00ad',

  // Typography
  copy: '\u00a9', reg: '\u00ae', trade: '\u2122', hellip: '\u2026', mldr: '\u2026',
  mdash: '\u2014', ndash: '\u2013', horbar: '\u2015',
  lsquo: '\u2018', rsquo: '\u2019', sbquo: '\u201a',
  ldquo: '\u201c', rdquo: '\u201d', bdquo: '\u201e',
  laquo: '\u00ab', raquo: '\u00bb', lsaquo: '\u2039', rsaquo: '\u203a',
  bull: '\u2022', middot: '\u00b7', dagger: '\u2020', Dagger: '\u2021',
  para: '\u00b6', sect: '\u00a7', permil: '\u2030', prime: '\u2032', Prime: '\u2033',

  // Currency and mathematics
  euro: '\u20ac', pound: '\u00a3', yen: '\u00a5', cent: '\u00a2', curren: '\u00a4',
  deg: '\u00b0', plusmn: '\u00b1', times: '\u00d7', divide: '\u00f7', minus: '\u2212',
  frac12: '\u00bd', frac14: '\u00bc', frac34: '\u00be',
  sup1: '\u00b9', sup2: '\u00b2', sup3: '\u00b3', micro: '\u00b5',
  ne: '\u2260', le: '\u2264', ge: '\u2265', infin: '\u221e', asymp: '\u2248', equiv: '\u2261',
  radic: '\u221a', sum: '\u2211', prod: '\u220f', part: '\u2202', int: '\u222b',
  fnof: '\u0192', prop: '\u221d', ang: '\u2220', and: '\u2227', or: '\u2228',
  cap: '\u2229', cup: '\u222a', sube: '\u2286', supe: '\u2287',
  isin: '\u2208', notin: '\u2209', empty: '\u2205', nabla: '\u2207', there4: '\u2234',

  // Arrows
  larr: '\u2190', uarr: '\u2191', rarr: '\u2192', darr: '\u2193', harr: '\u2194', crarr: '\u21b5',
  lArr: '\u21d0', uArr: '\u21d1', rArr: '\u21d2', dArr: '\u21d3', hArr: '\u21d4',

  // Greek, which scientific and mathematical writing needs
  alpha: '\u03b1', beta: '\u03b2', gamma: '\u03b3', delta: '\u03b4', epsilon: '\u03b5',
  zeta: '\u03b6', eta: '\u03b7', theta: '\u03b8', iota: '\u03b9', kappa: '\u03ba',
  lambda: '\u03bb', mu: '\u03bc', nu: '\u03bd', xi: '\u03be', omicron: '\u03bf',
  pi: '\u03c0', rho: '\u03c1', sigmaf: '\u03c2', sigma: '\u03c3', tau: '\u03c4',
  upsilon: '\u03c5', phi: '\u03c6', chi: '\u03c7', psi: '\u03c8', omega: '\u03c9',
  Alpha: '\u0391', Beta: '\u0392', Gamma: '\u0393', Delta: '\u0394', Epsilon: '\u0395',
  Zeta: '\u0396', Eta: '\u0397', Theta: '\u0398', Iota: '\u0399', Kappa: '\u039a',
  Lambda: '\u039b', Mu: '\u039c', Nu: '\u039d', Xi: '\u039e', Omicron: '\u039f',
  Pi: '\u03a0', Rho: '\u03a1', Sigma: '\u03a3', Tau: '\u03a4', Upsilon: '\u03a5',
  Phi: '\u03a6', Chi: '\u03a7', Psi: '\u03a8', Omega: '\u03a9',

  // Latin-1 letters
  Agrave: '\u00c0', Aacute: '\u00c1', Acirc: '\u00c2', Atilde: '\u00c3', Auml: '\u00c4',
  Aring: '\u00c5', AElig: '\u00c6', Ccedil: '\u00c7', Egrave: '\u00c8', Eacute: '\u00c9',
  Ecirc: '\u00ca', Euml: '\u00cb', Igrave: '\u00cc', Iacute: '\u00cd', Icirc: '\u00ce',
  Iuml: '\u00cf', ETH: '\u00d0', Ntilde: '\u00d1', Ograve: '\u00d2', Oacute: '\u00d3',
  Ocirc: '\u00d4', Otilde: '\u00d5', Ouml: '\u00d6', Oslash: '\u00d8', Ugrave: '\u00d9',
  Uacute: '\u00da', Ucirc: '\u00db', Uuml: '\u00dc', Yacute: '\u00dd', THORN: '\u00de',
  szlig: '\u00df',
  agrave: '\u00e0', aacute: '\u00e1', acirc: '\u00e2', atilde: '\u00e3', auml: '\u00e4',
  aring: '\u00e5', aelig: '\u00e6', ccedil: '\u00e7', egrave: '\u00e8', eacute: '\u00e9',
  ecirc: '\u00ea', euml: '\u00eb', igrave: '\u00ec', iacute: '\u00ed', icirc: '\u00ee',
  iuml: '\u00ef', eth: '\u00f0', ntilde: '\u00f1', ograve: '\u00f2', oacute: '\u00f3',
  ocirc: '\u00f4', otilde: '\u00f5', ouml: '\u00f6', oslash: '\u00f8', ugrave: '\u00f9',
  uacute: '\u00fa', ucirc: '\u00fb', uuml: '\u00fc', yacute: '\u00fd', thorn: '\u00fe',
  yuml: '\u00ff', Yuml: '\u0178', OElig: '\u0152', oelig: '\u0153',
  Scaron: '\u0160', scaron: '\u0161',
  iexcl: '\u00a1', iquest: '\u00bf', ordf: '\u00aa', ordm: '\u00ba', not: '\u00ac',
  macr: '\u00af', acute: '\u00b4', cedil: '\u00b8', uml: '\u00a8', brvbar: '\u00a6'
}

/**
 * Decode HTML entities.
 *
 * Needed *before* a URL is scheme-checked, because `&#x6A;avascript:alert(1)`
 * is inert text to a comparison and a working URL to a browser.
 *
 * @param {string} text
 * @returns {string}
 */
export function decodeEntities(text) {
  // The digit limits are the spec's, not arbitrary: a numeric reference longer
  // than this is not a reference at all and stays literal text.
  return String(text).replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10)

      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '�'
      // Surrogate halves are not characters; emitting them makes lone
      // surrogates that break JSON encoding downstream.
      if (code >= 0xd800 && code <= 0xdfff) return '�'

      try {
        return String.fromCodePoint(code)
      } catch {
        return '�'
      }
    }

    const named = NAMED_ENTITIES[body]
    return named === undefined ? match : named
  })
}

/**
 * Strip HTML to a plain-text approximation.
 *
 * @param {string} html
 * @returns {string}
 */
export function stripTags(html) {
  const withoutBlocks = String(html).replace(
    /<(script|style|template|noscript|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    ' '
  )

  return decodeEntities(withoutBlocks.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Sanitize an HTML fragment against an allowlist.
 *
 * @param {string} html
 * @param {Object} [options]
 * @param {Object} [options.allowed] - tag → permitted attributes
 * @param {string[]} [options.schemes] - permitted URL schemes
 * @param {boolean} [options.allowDataImages] - permit `data:image/...` in `src`
 * @returns {string}
 */
export function sanitizeHtml(html, options = {}) {
  if (html === null || html === undefined) return ''

  const allowed = options.allowed || DEFAULT_ALLOWED
  const schemes = options.schemes || DEFAULT_ALLOWED_SCHEMES

  // NUL is dropped by HTML parsers, so leaving it in lets "<scr\0ipt" reach the
  // browser as a script tag after having sailed past a tag-name comparison.
  const source = String(html).replace(/\0/g, '')

  let out = ''
  let i = 0
  /** @type {string[]} Open elements we emitted, so they can be closed in order. */
  const stack = []

  while (i < source.length) {
    const lt = source.indexOf('<', i)

    if (lt === -1) {
      out += escapeText(source.slice(i))
      break
    }

    out += escapeText(source.slice(i, lt))

    const parsed = readTag(source, lt)

    if (!parsed) {
      // A '<' that starts nothing is literal text.
      out += '&lt;'
      i = lt + 1
      continue
    }

    i = parsed.end

    // Comments, doctypes and processing instructions carry no prose and have a
    // long history of being parsed differently than they look.
    if (parsed.kind === 'comment') continue

    const name = parsed.name

    if (parsed.kind === 'close') {
      if (!allowed[name] || VOID_ELEMENTS.has(name)) continue

      const at = stack.lastIndexOf(name)
      if (at === -1) continue

      // Close anything opened inside it, so the output stays well-formed even
      // when the input was not.
      while (stack.length > at) {
        out += `</${stack.pop()}>`
      }
      continue
    }

    if (VOID_CONTENT.has(name)) {
      i = skipElement(source, parsed.end, name)
      continue
    }

    if (!allowed[name]) continue

    const attrs = filterAttributes(parsed.attrs, allowed[name], name, schemes, options)

    if (VOID_ELEMENTS.has(name)) {
      out += `<${name}${attrs}>`
      continue
    }

    out += `<${name}${attrs}>`
    stack.push(name)
  }

  while (stack.length) out += `</${stack.pop()}>`

  return out
}

/**
 * Escape a run of text, leaving no way for it to become markup.
 *
 * Decoding first is what makes this idempotent. Without it, sanitizing text
 * that is already escaped turns `&lt;` into `&amp;lt;`, and the reader sees the
 * escape sequence printed on the page instead of the character. That matters
 * here because the Markdown parser escapes as it renders and this runs over its
 * output — so every `<` in a code block would come out mangled.
 *
 * Decoding cannot reintroduce a hazard: escaping runs afterwards and covers
 * every character that could start markup.
 */
function escapeText(text) {
  return decodeEntities(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Read one tag starting at `<`.
 *
 * Attribute values are consumed with their quoting respected, so a `>` inside
 * `title="a > b"` does not end the tag early — a mismatch that has been the
 * seam in more than one sanitizer bypass.
 */
function readTag(source, start) {
  const rest = source.slice(start)

  if (rest.startsWith('<!--')) {
    const end = source.indexOf('-->', start + 4)
    return { kind: 'comment', end: end === -1 ? source.length : end + 3 }
  }

  if (rest.startsWith('<![CDATA[')) {
    const end = source.indexOf(']]>', start + 9)
    return { kind: 'comment', end: end === -1 ? source.length : end + 3 }
  }

  if (rest.startsWith('<!') || rest.startsWith('<?')) {
    const end = source.indexOf('>', start + 2)
    return { kind: 'comment', end: end === -1 ? source.length : end + 1 }
  }

  const match = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/.exec(rest)
  if (!match) return null

  const isClose = match[1] === '/'
  // Namespace prefixes are stripped rather than trusted; `<svg:script>` should
  // not become an allowed `script` by any route, and it cannot, because the
  // local name is matched against the allowlist.
  const name = match[2].toLowerCase().split(':').pop()

  let i = start + match[0].length
  const attrs = []

  while (i < source.length) {
    while (i < source.length && /[\s/]/.test(source[i])) i++

    if (i >= source.length) break
    if (source[i] === '>') { i++; break }

    const nameMatch = /^[^\s=/>]+/.exec(source.slice(i))
    if (!nameMatch) { i++; continue }

    const attrName = nameMatch[0].toLowerCase()
    i += nameMatch[0].length

    while (i < source.length && /\s/.test(source[i])) i++

    let value = ''
    if (source[i] === '=') {
      i++
      while (i < source.length && /\s/.test(source[i])) i++

      const quote = source[i]
      if (quote === '"' || quote === "'") {
        const end = source.indexOf(quote, i + 1)
        value = end === -1 ? source.slice(i + 1) : source.slice(i + 1, end)
        i = end === -1 ? source.length : end + 1
      } else {
        const unquoted = /^[^\s>]*/.exec(source.slice(i))
        value = unquoted ? unquoted[0] : ''
        i += value.length
      }
    }

    attrs.push([attrName, value])
  }

  return { kind: isClose ? 'close' : 'open', name, attrs, end: i }
}

/** Skip past an element and everything it contains. */
function skipElement(source, from, name) {
  const closing = new RegExp(`</${name}\\s*>`, 'i')
  const rest = source.slice(from)
  const match = closing.exec(rest)

  return match ? from + match.index + match[0].length : source.length
}

/** Keep only allowed attributes, and only when their value is acceptable. */
function filterAttributes(attrs, permitted, tag, schemes, options) {
  let out = ''

  for (const [name, rawValue] of attrs) {
    // Anything starting `on` is an event handler. This is belt-and-braces —
    // no allowlist here names one — but it costs nothing and the failure mode
    // if someone widens an allowlist carelessly is severe.
    if (name.startsWith('on')) continue
    if (!permitted.includes(name)) continue

    // Entities are decoded first so the scheme check sees what the browser
    // will see rather than what the source spells.
    const value = decodeEntities(rawValue)

    if (URL_ATTRIBUTES.has(name)) {
      if (options.allowDataImages && tag === 'img' && name === 'src' && isSafeDataImage(value)) {
        out += ` ${name}="${escapeAttr(value)}"`
        continue
      }

      if (!isSafeUrl(value, schemes)) continue
    }

    // A style attribute can load a URL, position an element over a real
    // control, or hide one. Allowing it needs a CSS parser, so it is not
    // allowed.
    if (name === 'style') continue

    out += ` ${name}="${escapeAttr(value)}"`
  }

  // Links that leave the site get noopener: without it the opened page can
  // reach back through window.opener and navigate this one.
  if (tag === 'a' && /\starget=/.test(out) && !/\srel=/.test(out)) {
    out += ' rel="noopener noreferrer"'
  }

  return out
}

/**
 * Whether a data: URI is an image and nothing else.
 *
 * Off by default. `data:image/svg+xml` is excluded even here — an SVG is a
 * document that can carry script, so it is an image in name only.
 */
function isSafeDataImage(value) {
  return /^data:image\/(png|jpe?g|gif|webp|avif);base64,[a-zA-Z0-9+/=\s]*$/i.test(value)
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
