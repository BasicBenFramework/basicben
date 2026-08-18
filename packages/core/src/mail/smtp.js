/**
 * SMTP client.
 *
 * Enough of RFC 5321 to hand a message to a relay: EHLO, optional STARTTLS,
 * AUTH PLAIN or LOGIN, then the MAIL/RCPT/DATA exchange. Built on node:net and
 * node:tls, so it adds no dependency.
 *
 * Two ways to get an encrypted session, and which one you use is decided by the
 * port rather than by a setting worth thinking about:
 *
 *   465  implicit TLS — the socket is TLS from the first byte
 *   587  STARTTLS — connect in the clear, then upgrade before authenticating
 *
 * Credentials are never sent before the session is encrypted. If a server on a
 * submission port does not offer STARTTLS, this refuses to authenticate rather
 * than leaking the password.
 */

import { createConnection } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import { buildMessage, extractAddresses, extractAddress } from './message.js'

/**
 * Create an SMTP transport.
 *
 * @param {Object} options
 * @param {string} options.host
 * @param {number} [options.port] - defaults to 465 when secure, else 587
 * @param {boolean} [options.secure] - implicit TLS; inferred from port 465
 * @param {string} [options.user]
 * @param {string} [options.pass]
 * @param {boolean|'required'} [options.requireTls] - default 'required' when
 *   credentials are supplied, false otherwise
 * @param {number} [options.timeout] - socket timeout in ms
 * @param {string} [options.name] - hostname sent in EHLO
 * @param {Object} [options.tls] - extra options for node:tls
 * @returns {(message: Object) => Promise<{ messageId: string, accepted: string[] }>}
 */
export function smtpTransport(options = {}) {
  const host = options.host
  if (!host) throw new Error('smtpTransport requires a host')

  const secure = options.secure ?? options.port === 465
  const port = options.port ?? (secure ? 465 : 587)
  const timeout = options.timeout ?? 20000
  const clientName = options.name || 'localhost'
  const user = options.user
  const pass = options.pass

  // Credentials must not cross a plaintext link. A caller can opt out for a
  // local relay like Mailpit, which has no TLS and no password either.
  const requireTls = options.requireTls ?? (user ? 'required' : false)

  return async function send(message) {
    const envelopeFrom = extractAddress(message.from)
    const recipients = extractAddresses([
      ...(Array.isArray(message.to) ? message.to : [message.to]),
      ...(message.cc ? [message.cc] : []),
      ...(message.bcc ? [message.bcc] : [])
    ])

    if (recipients.length === 0) {
      throw new Error('Mail message requires at least one recipient')
    }

    const raw = buildMessage(message)
    const session = await openSession({ host, port, secure, timeout, tls: options.tls })

    try {
      await session.expect(220)

      let capabilities = await ehlo(session, clientName)

      if (!secure && capabilities.has('STARTTLS') && requireTls !== false) {
        await session.command('STARTTLS', 220)
        await session.upgrade({ host, ...options.tls })
        // Capabilities announced before TLS cannot be trusted, so ask again.
        capabilities = await ehlo(session, clientName)
      }

      if (user) {
        if (!session.encrypted && requireTls === 'required') {
          throw new Error(
            `Refusing to send SMTP credentials over an unencrypted connection to ${host}:${port}. ` +
            'The server did not offer STARTTLS. Use port 465, or set requireTls: false if the ' +
            'link is already trusted.'
          )
        }
        await authenticate(session, capabilities, user, pass)
      }

      await session.command(`MAIL FROM:<${envelopeFrom}>`, 250)

      const accepted = []
      for (const recipient of recipients) {
        await session.command(`RCPT TO:<${recipient}>`, 250)
        accepted.push(recipient)
      }

      await session.command('DATA', 354)
      await session.write(`${stuffDots(raw)}\r\n.\r\n`)
      await session.expect(250)

      // A failure to say goodbye politely does not un-send the message.
      await session.command('QUIT', 221).catch(() => {})

      return {
        messageId: raw.match(/^Message-ID:\s*(.+)$/im)?.[1]?.trim() ?? null,
        accepted
      }
    } finally {
      session.close()
    }
  }
}

/**
 * Resend's SMTP relay.
 *
 * The username is literally "resend" and the password is the API key — the
 * same key the HTTP API uses.
 *
 * @param {Object} options
 * @param {string} options.apiKey
 * @param {number} [options.port] - 465 implicit TLS (default), or 587 STARTTLS
 * @returns {Function} transport
 */
export function resendTransport(options = {}) {
  if (!options.apiKey) {
    throw new Error('resendTransport requires an apiKey')
  }

  return smtpTransport({
    host: options.host || 'smtp.resend.com',
    port: options.port ?? 465,
    user: 'resend',
    pass: options.apiKey,
    ...options.smtp
  })
}

/**
 * EHLO, returning the advertised capability keywords.
 */
async function ehlo(session, clientName) {
  const response = await session.command(`EHLO ${clientName}`, 250)

  const capabilities = new Set()

  for (const line of response.lines) {
    // Each line is "250-KEYWORD args" or "250 KEYWORD args"; the first is the
    // server's own domain rather than a capability.
    const withoutCode = line.replace(/^\d{3}[- ]?/, '').trim()
    if (!withoutCode) continue

    const [keyword, ...args] = withoutCode.split(/\s+/)
    const upper = keyword.toUpperCase()

    // Skip the greeting line, which carries no extension.
    if (upper.includes('.') && args.length === 0 && capabilities.size === 0) continue

    capabilities.add(upper)

    if (upper === 'AUTH') {
      for (const mechanism of args) {
        capabilities.add(`AUTH ${mechanism.toUpperCase()}`)
      }
    }
  }

  return capabilities
}

/**
 * Authenticate with whichever mechanism the server offers.
 */
async function authenticate(session, capabilities, user, pass) {
  const supportsPlain = capabilities.has('AUTH PLAIN')
  const supportsLogin = capabilities.has('AUTH LOGIN')

  if (supportsPlain || (!supportsLogin && capabilities.has('AUTH'))) {
    const token = Buffer.from(`\0${user}\0${pass ?? ''}`, 'utf8').toString('base64')
    await session.command(`AUTH PLAIN ${token}`, 235)
    return
  }

  if (supportsLogin) {
    await session.command('AUTH LOGIN', 334)
    await session.command(Buffer.from(String(user), 'utf8').toString('base64'), 334)
    await session.command(Buffer.from(String(pass ?? ''), 'utf8').toString('base64'), 235)
    return
  }

  throw new Error('SMTP server advertised no supported AUTH mechanism (need PLAIN or LOGIN)')
}

/**
 * A line beginning with "." would end the DATA block early, so it is doubled.
 * Bodies are base64 so this should never fire, but headers are not.
 */
function stuffDots(raw) {
  return raw.replace(/\r\n\./g, '\r\n..').replace(/^\./, '..')
}

/**
 * Open a connection and wrap it in a small request/response session.
 */
async function openSession({ host, port, secure, timeout, tls }) {
  let socket = await new Promise((resolve, reject) => {
    const onError = (err) => reject(new Error(`SMTP connection to ${host}:${port} failed: ${err.message}`))

    const s = secure
      ? tlsConnect({ host, port, ...tls }, () => resolve(s))
      : createConnection({ host, port }, () => resolve(s))

    s.once('error', onError)
    s.setTimeout(timeout, () => {
      s.destroy()
      reject(new Error(`SMTP connection to ${host}:${port} timed out after ${timeout}ms`))
    })
  })

  let buffer = ''
  let pending = null
  let fatal = null

  function attach(s) {
    s.setEncoding('utf8')
    s.on('data', (chunk) => {
      buffer += chunk
      flush()
    })
    s.on('error', (err) => {
      fatal = err
      if (pending) {
        pending.reject(err)
        pending = null
      }
    })
    s.on('close', () => {
      if (pending) {
        pending.reject(fatal ?? new Error('SMTP connection closed unexpectedly'))
        pending = null
      }
    })
  }

  /**
   * A reply is complete when a line has a space rather than a hyphen after the
   * status code — `250-EXTENSION` continues, `250 OK` ends.
   */
  function flush() {
    if (!pending) return

    const match = buffer.match(/^\d{3}(?: [^\r\n]*)?\r\n/m)
    const lines = buffer.split('\r\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
        const consumed = lines.slice(0, i + 1)
        buffer = lines.slice(i + 1).join('\r\n')
        const code = parseInt(consumed[consumed.length - 1].slice(0, 3), 10)
        const resolve = pending.resolve
        pending = null
        resolve({ code, lines: consumed, text: consumed.join('\n') })
        return
      }
    }

    void match
  }

  function read() {
    if (fatal) return Promise.reject(fatal)
    return new Promise((resolve, reject) => {
      pending = { resolve, reject }
      flush()
    })
  }

  attach(socket)

  const session = {
    get encrypted() {
      return Boolean(socket.encrypted)
    },

    write(data) {
      return new Promise((resolve, reject) => {
        socket.write(data, (err) => (err ? reject(err) : resolve()))
      })
    },

    async expect(code) {
      const response = await read()
      if (response.code !== code) {
        throw new Error(`SMTP expected ${code} but got ${response.code}: ${response.text}`)
      }
      return response
    },

    async command(line, expected) {
      await session.write(`${line}\r\n`)
      const response = await read()

      if (expected !== undefined && response.code !== expected) {
        // Never echo the command back — it may be an AUTH line carrying a
        // base64-encoded password.
        const verb = line.split(' ')[0]
        throw new Error(`SMTP ${verb} failed with ${response.code}: ${response.text}`)
      }

      return response
    },

    async upgrade(tlsOptions) {
      const plain = socket
      plain.removeAllListeners('data')
      plain.removeAllListeners('error')
      plain.removeAllListeners('close')

      socket = await new Promise((resolve, reject) => {
        const upgraded = tlsConnect({ socket: plain, ...tlsOptions }, () => resolve(upgraded))
        upgraded.once('error', reject)
      })

      buffer = ''
      attach(socket)
    },

    close() {
      try {
        socket.destroy()
      } catch {
        // already gone
      }
    }
  }

  return session
}
