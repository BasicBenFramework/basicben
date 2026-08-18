/**
 * MIME message building.
 *
 * Enough of RFC 5322 and RFC 2045 to send the kind of mail an application
 * sends: a subject, a plain-text part, and optionally an HTML alternative.
 *
 * Bodies are base64-encoded rather than sent raw. That is not about size — it
 * sidesteps three separate footguns at once: non-ASCII characters that would
 * need quoted-printable, lines longer than the 998-octet limit in RFC 5322, and
 * a line beginning with "." which SMTP would otherwise read as end-of-data.
 */

import { randomBytes } from 'node:crypto'

/**
 * Build an RFC 5322 message.
 *
 * @param {Object} message
 * @param {string} message.from
 * @param {string|string[]} message.to
 * @param {string} message.subject
 * @param {string} [message.text]
 * @param {string} [message.html]
 * @param {string} [message.replyTo]
 * @param {Object} [message.headers] - additional headers
 * @param {Date} [message.date]
 * @param {string} [message.messageId]
 * @returns {string} the full message, CRLF-delimited
 */
export function buildMessage(message) {
  const to = toList(message.to)

  if (!message.from) throw new Error('Mail message requires a "from" address')
  if (to.length === 0) throw new Error('Mail message requires at least one recipient')

  const headers = [
    ['From', encodeHeader(message.from)],
    ['To', to.map(encodeHeader).join(', ')],
    ['Subject', encodeHeader(message.subject ?? '')],
    ['Date', (message.date ?? new Date()).toUTCString()],
    ['Message-ID', message.messageId ?? generateMessageId(message.from)],
    ['MIME-Version', '1.0']
  ]

  if (message.replyTo) headers.push(['Reply-To', encodeHeader(message.replyTo)])

  for (const [name, value] of Object.entries(message.headers ?? {})) {
    headers.push([name, encodeHeader(String(value))])
  }

  const text = message.text
  const html = message.html

  if (!text && !html) {
    throw new Error('Mail message requires text or html content')
  }

  let body

  if (text && html) {
    // Both parts offered, least-capable first — a reader picks the last one it
    // understands, which is what makes HTML the preferred alternative.
    const boundary = `--=_bb_${randomBytes(12).toString('hex')}`
    headers.push(['Content-Type', `multipart/alternative; boundary="${boundary}"`])

    body = [
      `--${boundary}`,
      ...partHeaders('text/plain'),
      '',
      base64Body(text),
      `--${boundary}`,
      ...partHeaders('text/html'),
      '',
      base64Body(html),
      `--${boundary}--`,
      ''
    ].join('\r\n')
  } else {
    const type = html ? 'text/html' : 'text/plain'
    headers.push(['Content-Type', `${type}; charset=utf-8`])
    headers.push(['Content-Transfer-Encoding', 'base64'])
    body = base64Body(html ?? text)
  }

  const head = headers.map(([name, value]) => `${name}: ${value}`).join('\r\n')

  return `${head}\r\n\r\n${body}`
}

/**
 * Extract the bare addresses for the SMTP envelope.
 *
 * The envelope is separate from the headers: "Ada <ada@example.com>" is a fine
 * header value but SMTP wants only what is inside the angle brackets.
 *
 * @param {string|string[]} value
 * @returns {string[]}
 */
export function extractAddresses(value) {
  return toList(value).map(extractAddress)
}

/**
 * Pull the address out of a possibly-decorated string.
 *
 * @param {string} value
 * @returns {string}
 */
export function extractAddress(value) {
  const match = String(value).match(/<([^>]+)>/)
  return (match ? match[1] : String(value)).trim()
}

function toList(value) {
  if (value === undefined || value === null) return []
  return (Array.isArray(value) ? value : [value])
    .flatMap((entry) => String(entry).split(','))
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function partHeaders(type) {
  return [
    `Content-Type: ${type}; charset=utf-8`,
    'Content-Transfer-Encoding: base64'
  ]
}

/**
 * Base64 the body and wrap at 76 characters, as RFC 2045 requires.
 */
function base64Body(content) {
  const encoded = Buffer.from(String(content), 'utf8').toString('base64')
  const lines = []
  for (let i = 0; i < encoded.length; i += 76) {
    lines.push(encoded.slice(i, i + 76))
  }
  return lines.join('\r\n')
}

/**
 * Encode a header value.
 *
 * Headers are ASCII-only, so anything outside it goes in an RFC 2047 encoded
 * word. A display name is encoded while the address inside the brackets is left
 * alone, since the address itself must stay literal.
 *
 * @param {string} value
 * @returns {string}
 */
export function encodeHeader(value) {
  const str = String(value)

  // Strip anything that could inject a second header. A newline in a subject
  // taken from user input would otherwise let a caller add headers of their own.
  const safe = str.replace(/[\r\n]+/g, ' ')

  if (isAscii(safe)) return safe

  const match = safe.match(/^(.*?)\s*<([^>]+)>$/)
  if (match) {
    const [, name, address] = match
    return `${encodeWord(name)} <${address}>`
  }

  return encodeWord(safe)
}

function encodeWord(value) {
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

function isAscii(value) {
  // eslint-disable-next-line no-control-regex
  return !/[^\x00-\x7F]/.test(value)
}

function generateMessageId(from) {
  const domain = extractAddress(from).split('@')[1] || 'localhost'
  return `<${randomBytes(16).toString('hex')}@${domain}>`
}
