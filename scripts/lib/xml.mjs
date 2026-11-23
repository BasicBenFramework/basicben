/**
 * A small XML parser, for WordPress export (WXR) files and nothing grander.
 *
 * ## Why not a library
 *
 * The project takes no new dependencies, and WXR is a narrow subset of XML:
 * elements, attributes, text, CDATA, comments and a processing instruction at
 * the top. Namespaces appear only as prefixes (`wp:post_id`,
 * `content:encoded`), and nothing in a WXR file needs them resolved to URIs —
 * so names are kept exactly as written and looked up the same way.
 *
 * ## Why it refuses DTDs
 *
 * Entity declarations are how XML parsers get exploited: an internal subset
 * can define an entity that expands a billion times ("billion laughs"), or an
 * external one that reads a file off the importing machine. An export file is
 * input from somewhere else, so a document carrying an internal DTD subset is
 * refused outright, and only the five predefined entities and numeric
 * character references are ever decoded. WordPress never writes a DTD, so a
 * real export never trips this.
 *
 * ## Shape
 *
 * Elements are `{ name, attrs, children }`, text is a plain string in
 * `children`. CDATA becomes text verbatim. Comments and processing
 * instructions are dropped.
 */

const PREDEFINED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** Past this a document is either hostile or broken; WXR nests about six deep. */
const MAX_DEPTH = 256

export class XmlError extends Error {
  constructor(message, source, index) {
    const line = source.slice(0, index).split('\n').length
    super(`${message} (line ${line})`)
    this.name = 'XmlError'
  }
}

/**
 * Decode the entities XML itself defines, and nothing else.
 *
 * An unknown named entity is left as literal text rather than failing the
 * whole file — WordPress has been known to let `&nbsp;` slip into a field it
 * did not wrap in CDATA, and dropping a post over it would be worse.
 *
 * @param {string} text
 * @returns {string}
 */
export function decodeXmlEntities(text) {
  return text.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z]+);/g, (match, body) => {
    if (body[0] !== '#') return PREDEFINED[body] ?? match

    const code = body[1] === 'x' || body[1] === 'X'
      ? parseInt(body.slice(2), 16)
      : parseInt(body.slice(1), 10)

    // Surrogate halves and out-of-range values are not characters.
    if (!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�'

    return String.fromCodePoint(code)
  })
}

/**
 * Parse a document into a tree.
 *
 * @param {string} source
 * @returns {{ name: '#document', attrs: {}, children: Array }}
 */
export function parseXml(source) {
  const src = String(source).replace(/^﻿/, '')
  const root = { name: '#document', attrs: {}, children: [] }
  const stack = [root]
  let i = 0

  const top = () => stack[stack.length - 1]

  const expect = (token, from) => {
    const end = src.indexOf(token, from)
    if (end === -1) throw new XmlError(`Unterminated construct, expected "${token}"`, src, from)
    return end
  }

  while (i < src.length) {
    const lt = src.indexOf('<', i)

    if (lt === -1) {
      pushText(top(), decodeXmlEntities(src.slice(i)))
      break
    }

    if (lt > i) pushText(top(), decodeXmlEntities(src.slice(i, lt)))

    if (src.startsWith('<!--', lt)) {
      i = expect('-->', lt + 4) + 3
    } else if (src.startsWith('<![CDATA[', lt)) {
      const end = expect(']]>', lt + 9)
      pushText(top(), src.slice(lt + 9, end))
      i = end + 3
    } else if (src.startsWith('<?', lt)) {
      i = expect('?>', lt + 2) + 2
    } else if (src.startsWith('<!', lt)) {
      // A DOCTYPE. Skipped if it is only a name; refused if it declares
      // anything, since declarations are what entity expansion attacks use.
      const end = expect('>', lt)
      if (src.slice(lt, end).includes('[')) {
        throw new XmlError('Documents with a DTD internal subset are not accepted', src, lt)
      }
      i = end + 1
    } else if (src[lt + 1] === '/') {
      const end = expect('>', lt)
      const name = src.slice(lt + 2, end).trim()
      const open = top()

      if (open === root || open.name !== name) {
        throw new XmlError(`Unexpected closing tag </${name}>${open === root ? '' : `, expected </${open.name}>`}`, src, lt)
      }

      stack.pop()
      i = end + 1
    } else {
      const { element, end, selfClosing } = readTag(src, lt)
      top().children.push(element)

      if (!selfClosing) {
        if (stack.length > MAX_DEPTH) throw new XmlError('Document nests too deeply', src, lt)
        stack.push(element)
      }

      i = end
    }
  }

  if (stack.length > 1) {
    throw new XmlError(`Unclosed element <${top().name}>`, src, src.length)
  }

  return root
}

/** Merge adjacent text, so a field split by CDATA reads as one string. */
function pushText(parent, text) {
  if (!text) return
  const last = parent.children.length - 1
  if (typeof parent.children[last] === 'string') parent.children[last] += text
  else parent.children.push(text)
}

/** Read `<name a="b" c='d'>` or `<name/>` starting at `start`. */
function readTag(src, start) {
  let i = start + 1
  const nameMatch = /^[^\s/>]+/.exec(src.slice(i, i + 256))
  if (!nameMatch) throw new XmlError('Malformed tag', src, start)

  const name = nameMatch[0]
  const attrs = {}
  i += name.length

  while (i < src.length) {
    while (/\s/.test(src[i])) i++

    if (src[i] === '>') return { element: { name, attrs, children: [] }, end: i + 1, selfClosing: false }
    if (src[i] === '/' && src[i + 1] === '>') return { element: { name, attrs, children: [] }, end: i + 2, selfClosing: true }

    const attrMatch = /^([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/.exec(src.slice(i, i + 65536))
    if (!attrMatch) throw new XmlError(`Malformed attribute in <${name}>`, src, i)

    attrs[attrMatch[1]] = decodeXmlEntities(attrMatch[3] ?? attrMatch[4] ?? '')
    i += attrMatch[0].length
  }

  throw new XmlError(`Unterminated tag <${name}>`, src, start)
}

/** The first child element called `name`. */
export function child(node, name) {
  return node?.children?.find((c) => typeof c !== 'string' && c.name === name)
}

/** Every child element called `name`. */
export function childrenNamed(node, name) {
  return (node?.children ?? []).filter((c) => typeof c !== 'string' && c.name === name)
}

/** All the text inside a node, CDATA included. */
export function textOf(node) {
  if (node === undefined || node === null) return ''
  if (typeof node === 'string') return node
  return node.children.map(textOf).join('')
}

/** The trimmed text of the first child called `name`, or ''. */
export function childText(node, name) {
  return textOf(child(node, name)).trim()
}
