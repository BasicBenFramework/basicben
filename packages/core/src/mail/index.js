/**
 * Mail.
 *
 * A transport is any async function taking a message — that is the whole
 * interface, so adapting a client this framework does not ship is a few lines.
 * Four are built in: console for development, smtp, resend (smtp, preconfigured)
 * and a generic http one for provider APIs.
 */

import { loadConfig } from '../server/loader.js'
import { hooks, HOOKS } from '../hooks/index.js'
import { buildMessage, extractAddresses } from './message.js'
import { smtpTransport, resendTransport } from './smtp.js'

export { smtpTransport, resendTransport }
export { buildMessage, extractAddresses, extractAddress, encodeHeader } from './message.js'
export { renderMail } from './render.js'

let cached = null

/**
 * Send a message using the configured transport.
 *
 * @param {Object} message - { to, subject, text, html, from?, replyTo?, headers? }
 * @returns {Promise<Object>} whatever the transport returns
 */
export async function sendMail(message) {
  const { transport, from } = await getMailer()

  const payload = { from, ...message }

  if (!payload.from) {
    throw new Error(
      'No "from" address. Set mail.from in basicben.config.js, or pass from on the message.'
    )
  }

  const context = await hooks.filter(HOOKS.MAIL_SENDING, payload)
  const outgoing = context ?? payload

  // A hook may cancel the send outright — useful for a plugin that suppresses
  // mail in a particular environment.
  if (outgoing.cancelled) {
    return { cancelled: true }
  }

  try {
    const result = await transport(outgoing)
    await hooks.fire(HOOKS.MAIL_SENT, { message: outgoing, result })
    return result
  } catch (error) {
    await hooks.fire(HOOKS.MAIL_FAILED, { message: outgoing, error })
    throw error
  }
}

/**
 * Resolve the configured transport.
 *
 * @returns {Promise<{ transport: Function, from: string }>}
 */
export async function getMailer() {
  if (cached) return cached

  const config = await loadConfig()
  const mail = config.mail || {}

  cached = {
    transport: resolveTransport(mail),
    from: mail.from || process.env.MAIL_FROM || ''
  }

  return cached
}

/**
 * Forget the resolved transport. Testing only.
 */
export function resetMailer() {
  cached = null
}

/**
 * Build a transport from config.
 *
 * Accepts a function directly, or a named transport with its options, which is
 * friendlier in a config file that would rather not import anything.
 *
 * @param {Object} mail
 * @returns {Function}
 */
export function resolveTransport(mail = {}) {
  if (typeof mail.transport === 'function') return mail.transport

  const name = mail.transport || 'console'

  switch (name) {
    case 'console':
      return consoleTransport(mail)

    case 'smtp':
      return smtpTransport({
        host: mail.host || process.env.SMTP_HOST,
        port: mail.port ?? numberFromEnv('SMTP_PORT'),
        secure: mail.secure,
        user: mail.user ?? process.env.SMTP_USER,
        pass: mail.pass ?? process.env.SMTP_PASS,
        requireTls: mail.requireTls,
        name: mail.name,
        tls: mail.tls,
        timeout: mail.timeout
      })

    case 'resend':
      return resendTransport({
        apiKey: mail.apiKey || process.env.RESEND_API_KEY,
        port: mail.port,
        host: mail.host
      })

    case 'http':
      return httpTransport(mail)

    default:
      throw new Error(
        `Unknown mail transport "${name}". ` +
        'Use console, smtp, resend, http, or pass a function.'
      )
  }
}

/**
 * Log the message instead of sending it.
 *
 * The default, so a new project works with no mail account. It prints the body,
 * which is what makes a verification link usable in development.
 *
 * @param {Object} [options]
 * @param {Function} [options.log]
 * @returns {Function} transport
 */
export function consoleTransport(options = {}) {
  const log = options.log || console.log

  return async function send(message) {
    const to = extractAddresses(message.to).join(', ')

    log(
      [
        '',
        '─── mail (console transport, not sent) ───',
        `From:    ${message.from}`,
        `To:      ${to}`,
        `Subject: ${message.subject ?? ''}`,
        '',
        message.text || stripTags(message.html || ''),
        '──────────────────────────────────────────',
        ''
      ].join('\n')
    )

    return { messageId: null, accepted: extractAddresses(message.to), console: true }
  }
}

/**
 * POST the message to a provider's HTTP API.
 *
 * Every modern provider offers one, so a single transport plus a `map` covers
 * Resend, Postmark, Mailgun, SES and the rest without a dependency each.
 *
 * @param {Object} options
 * @param {string} options.url
 * @param {Object} [options.headers]
 * @param {Function} [options.map] - message → request body
 * @returns {Function} transport
 */
export function httpTransport(options = {}) {
  if (!options.url) throw new Error('httpTransport requires a url')

  const map = options.map || ((message) => ({
    from: message.from,
    to: extractAddresses(message.to),
    subject: message.subject,
    text: message.text,
    html: message.html
  }))

  return async function send(message) {
    const response = await fetch(options.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      body: JSON.stringify(map(message))
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(
        `Mail provider responded ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`
      )
    }

    const payload = await response.json().catch(() => ({}))
    return { messageId: payload.id ?? null, accepted: extractAddresses(message.to), payload }
  }
}

/**
 * Render a message without sending it. Useful for previews and tests.
 *
 * @param {Object} message
 * @returns {string}
 */
export function renderRaw(message) {
  return buildMessage(message)
}

function stripTags(html) {
  return String(html).replace(/<[^>]+>/g, '').trim()
}

function numberFromEnv(name) {
  const value = process.env[name]
  return value ? Number(value) : undefined
}
