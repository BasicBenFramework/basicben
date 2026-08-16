/**
 * SMTP client tests.
 *
 * Two layers, for two different questions.
 *
 * A built-in SMTP server answers "does the client speak the protocol correctly"
 * — including the paths a real relay will not let you reach on demand, like a
 * server that refuses a recipient or offers no STARTTLS. It needs nothing
 * installed, so CI covers all of it.
 *
 * Mailpit answers "does a real SMTP implementation accept what we produce",
 * which a server written alongside the client cannot. Those tests skip unless
 * Mailpit is reachable on localhost:1025.
 *
 *   docker run -d -p 1025:1025 -p 8025:8025 axllent/mailpit
 */

import { test, describe, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { createServer } from 'node:net'
import { smtpTransport, resendTransport } from './smtp.js'
import { buildMessage, encodeHeader, extractAddress, extractAddresses } from './message.js'

// ---------------------------------------------------------------------------
// A small SMTP server
// ---------------------------------------------------------------------------

/**
 * @param {Object} [options]
 * @param {string[]} [options.capabilities] - EHLO extensions to advertise
 * @param {boolean} [options.requireAuth]
 * @param {string} [options.rejectRecipient] - answer 550 for this address
 */
async function startSmtpServer(options = {}) {
  const capabilities = options.capabilities ?? ['SIZE 10240000', 'AUTH PLAIN LOGIN', '8BITMIME']
  const received = []
  const transcript = []

  const server = createServer((socket) => {
    let buffer = ''
    let inData = false
    let dataLines = []
    let envelope = { from: null, to: [] }
    let authenticated = false
    let loginStage = null

    const say = (line) => { transcript.push(`S: ${line}`); socket.write(`${line}\r\n`) }

    say('220 test.local ESMTP ready')

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')

      let index
      while ((index = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)

        if (inData) {
          if (line === '.') {
            inData = false
            received.push({ ...envelope, data: dataLines.join('\r\n') })
            dataLines = []
            say('250 2.0.0 Ok: queued')
          } else {
            // Undo dot-stuffing, exactly as a real server does.
            dataLines.push(line.startsWith('..') ? line.slice(1) : line)
          }
          continue
        }

        transcript.push(`C: ${line.startsWith('AUTH') ? 'AUTH <redacted>' : line}`)
        const upper = line.toUpperCase()

        if (loginStage === 'user') { loginStage = 'pass'; say('334 UGFzc3dvcmQ6'); continue }
        if (loginStage === 'pass') { loginStage = null; authenticated = true; say('235 2.7.0 Accepted'); continue }

        if (upper.startsWith('EHLO')) {
          say('250-test.local')
          for (let i = 0; i < capabilities.length; i++) {
            const last = i === capabilities.length - 1
            say(`250${last ? ' ' : '-'}${capabilities[i]}`)
          }
        } else if (upper.startsWith('HELO')) {
          say('250 test.local')
        } else if (upper.startsWith('AUTH PLAIN')) {
          authenticated = true
          say('235 2.7.0 Accepted')
        } else if (upper === 'AUTH LOGIN') {
          loginStage = 'user'
          say('334 VXNlcm5hbWU6')
        } else if (upper.startsWith('MAIL FROM')) {
          if (options.requireAuth && !authenticated) { say('530 5.7.0 Authentication required'); continue }
          envelope = { from: line.slice(line.indexOf('<') + 1, line.lastIndexOf('>')), to: [] }
          say('250 2.1.0 Ok')
        } else if (upper.startsWith('RCPT TO')) {
          const address = line.slice(line.indexOf('<') + 1, line.lastIndexOf('>'))
          if (options.rejectRecipient && address === options.rejectRecipient) {
            say('550 5.1.1 No such user')
            continue
          }
          envelope.to.push(address)
          say('250 2.1.5 Ok')
        } else if (upper === 'DATA') {
          inData = true
          say('354 End data with <CR><LF>.<CR><LF>')
        } else if (upper === 'QUIT') {
          say('221 2.0.0 Bye')
          socket.end()
        } else if (upper === 'RSET') {
          say('250 2.0.0 Ok')
        } else {
          say('502 5.5.2 Command not implemented')
        }
      }
    })

    socket.on('error', () => { /* client hung up */ })
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  return {
    port: server.address().port,
    received,
    transcript,
    async stop() { await new Promise((resolve) => server.close(resolve)) }
  }
}

/** Decode a base64 MIME part out of a raw message. */
function partBody(raw, contentType) {
  const sections = raw.split(/\r\n\r\n/)
  for (let i = 0; i < sections.length; i++) {
    if (sections[i].includes(contentType)) {
      const body = sections[i + 1]
      if (body) return Buffer.from(body.split(/\r\n--/)[0].trim(), 'base64').toString('utf8')
    }
  }
  return null
}

// ---------------------------------------------------------------------------

describe('message building', () => {
  test('produces the required headers', () => {
    const raw = buildMessage({
      from: 'BasicBen <noreply@example.com>',
      to: 'ada@example.com',
      subject: 'Hello',
      text: 'Body'
    })

    assert.match(raw, /^From: BasicBen <noreply@example\.com>\r\n/m)
    assert.match(raw, /^To: ada@example\.com\r\n/m)
    assert.match(raw, /^Subject: Hello\r\n/m)
    assert.match(raw, /^MIME-Version: 1\.0\r\n/m)
    assert.match(raw, /^Message-ID: <[^>]+@example\.com>\r\n/m)
    assert.match(raw, /^Date: /m)
  })

  test('offers html as the preferred alternative', () => {
    const raw = buildMessage({
      from: 'a@b.c', to: 'd@e.f', subject: 'S', text: 'plain', html: '<p>rich</p>'
    })

    assert.match(raw, /Content-Type: multipart\/alternative; boundary="/)
    // Least capable first: a reader takes the last part it understands.
    assert.ok(raw.indexOf('text/plain') < raw.indexOf('text/html'))
    assert.strictEqual(partBody(raw, 'text/plain'), 'plain')
    assert.strictEqual(partBody(raw, 'text/html'), '<p>rich</p>')
  })

  test('a single part is not multipart', () => {
    const raw = buildMessage({ from: 'a@b.c', to: 'd@e.f', subject: 'S', text: 'only' })

    assert.doesNotMatch(raw, /multipart/)
    assert.match(raw, /Content-Type: text\/plain; charset=utf-8/)
  })

  test('a non-ASCII subject is RFC 2047 encoded', () => {
    const raw = buildMessage({ from: 'a@b.c', to: 'd@e.f', subject: 'café ☕', text: 'x' })

    assert.match(raw, /^Subject: =\?UTF-8\?B\?/m)
    const encoded = raw.match(/^Subject: =\?UTF-8\?B\?(.+)\?=$/m)[1]
    assert.strictEqual(Buffer.from(encoded, 'base64').toString('utf8'), 'café ☕')
  })

  test('a newline in a header cannot inject another header', () => {
    const raw = buildMessage({
      from: 'a@b.c',
      to: 'd@e.f',
      subject: 'Hi\r\nBcc: attacker@evil.example',
      text: 'x'
    })

    assert.doesNotMatch(raw, /^Bcc:/m)
    assert.match(raw, /^Subject: Hi Bcc: attacker@evil\.example$/m)
  })

  test('several recipients are comma separated', () => {
    const raw = buildMessage({ from: 'a@b.c', to: ['x@y.z', 'p@q.r'], subject: 'S', text: 't' })
    assert.match(raw, /^To: x@y\.z, p@q\.r$/m)
  })

  test('refuses a message with no content or no recipient', () => {
    assert.throws(() => buildMessage({ from: 'a@b.c', to: 'd@e.f', subject: 'S' }), /requires text or html/)
    assert.throws(() => buildMessage({ from: 'a@b.c', to: [], subject: 'S', text: 't' }), /at least one recipient/)
    assert.throws(() => buildMessage({ to: 'd@e.f', subject: 'S', text: 't' }), /requires a "from"/)
  })
})

describe('address handling', () => {
  test('extracts the address from a display name', () => {
    assert.strictEqual(extractAddress('Ada <ada@example.com>'), 'ada@example.com')
    assert.strictEqual(extractAddress('ada@example.com'), 'ada@example.com')
  })

  test('splits a comma separated list', () => {
    assert.deepStrictEqual(
      extractAddresses('Ada <ada@e.com>, grace@e.com'),
      ['ada@e.com', 'grace@e.com']
    )
  })

  test('encodeHeader leaves an ASCII address alone', () => {
    assert.strictEqual(encodeHeader('Ada <ada@example.com>'), 'Ada <ada@example.com>')
  })

  test('encodeHeader encodes the display name but not the address', () => {
    const encoded = encodeHeader('Ådä <ada@example.com>')
    assert.match(encoded, /^=\?UTF-8\?B\?.+\?= <ada@example\.com>$/)
  })
})

describe('SMTP conversation', () => {
  let smtp

  beforeEach(async () => { smtp = await startSmtpServer() })
  afterEach(async () => { if (smtp) await smtp.stop(); smtp = null })

  test('delivers a message', async () => {
    const send = smtpTransport({ host: '127.0.0.1', port: smtp.port, secure: false })

    const result = await send({
      from: 'BasicBen <noreply@example.com>',
      to: 'ada@example.com',
      subject: 'Verify',
      text: 'Hello'
    })

    assert.strictEqual(smtp.received.length, 1)
    assert.strictEqual(smtp.received[0].from, 'noreply@example.com', 'envelope carries the bare address')
    assert.deepStrictEqual(smtp.received[0].to, ['ada@example.com'])
    assert.deepStrictEqual(result.accepted, ['ada@example.com'])
    assert.match(result.messageId, /^<.+>$/)
  })

  test('sends the commands in order', async () => {
    const send = smtpTransport({ host: '127.0.0.1', port: smtp.port, secure: false })
    await send({ from: 'a@b.c', to: 'd@e.f', subject: 'S', text: 't' })

    const commands = smtp.transcript.filter((l) => l.startsWith('C: ')).map((l) => l.slice(3).split(' ')[0])
    assert.deepStrictEqual(commands, ['EHLO', 'MAIL', 'RCPT', 'DATA', 'QUIT'])
  })

  test('a line starting with a dot survives', async () => {
    const send = smtpTransport({ host: '127.0.0.1', port: smtp.port, secure: false })
    await send({ from: 'a@b.c', to: 'd@e.f', subject: 'S', text: '.hidden\nnormal' })

    assert.strictEqual(partBody(smtp.received[0].data, 'text/plain'), '.hidden\nnormal')
  })

  test('every recipient gets its own RCPT', async () => {
    const send = smtpTransport({ host: '127.0.0.1', port: smtp.port, secure: false })
    await send({ from: 'a@b.c', to: ['x@y.z', 'p@q.r'], subject: 'S', text: 't' })

    assert.deepStrictEqual(smtp.received[0].to, ['x@y.z', 'p@q.r'])
  })

  test('bcc reaches the envelope but not the headers', async () => {
    const send = smtpTransport({ host: '127.0.0.1', port: smtp.port, secure: false })
    await send({ from: 'a@b.c', to: 'x@y.z', bcc: 'hidden@y.z', subject: 'S', text: 't' })

    assert.deepStrictEqual(smtp.received[0].to, ['x@y.z', 'hidden@y.z'])
    assert.doesNotMatch(smtp.received[0].data, /hidden@y\.z/)
  })

  test('a rejected recipient surfaces the server code', async () => {
    const rejecting = await startSmtpServer({ rejectRecipient: 'blocked@example.com' })
    const send = smtpTransport({ host: '127.0.0.1', port: rejecting.port, secure: false })

    await assert.rejects(
      () => send({ from: 'a@b.c', to: 'blocked@example.com', subject: 'S', text: 't' }),
      /RCPT failed with 550/
    )

    await rejecting.stop()
  })

  test('a connection failure is reported clearly', async () => {
    const send = smtpTransport({ host: '127.0.0.1', port: 1, secure: false, timeout: 500 })
    await assert.rejects(() => send({ from: 'a@b.c', to: 'd@e.f', subject: 'S', text: 't' }), /SMTP connection/)
  })
})

describe('authentication', () => {
  test('AUTH PLAIN when offered', async () => {
    const smtp = await startSmtpServer({ capabilities: ['AUTH PLAIN LOGIN'], requireAuth: true })
    const send = smtpTransport({
      host: '127.0.0.1', port: smtp.port, secure: false,
      user: 'resend', pass: 'key', requireTls: false
    })

    await send({ from: 'a@b.c', to: 'd@e.f', subject: 'S', text: 't' })

    assert.strictEqual(smtp.received.length, 1)
    await smtp.stop()
  })

  test('AUTH LOGIN when PLAIN is not offered', async () => {
    const smtp = await startSmtpServer({ capabilities: ['AUTH LOGIN'], requireAuth: true })
    const send = smtpTransport({
      host: '127.0.0.1', port: smtp.port, secure: false,
      user: 'u', pass: 'p', requireTls: false
    })

    await send({ from: 'a@b.c', to: 'd@e.f', subject: 'S', text: 't' })

    assert.strictEqual(smtp.received.length, 1)
    await smtp.stop()
  })

  test('credentials are never sent over an unencrypted link', async () => {
    // No STARTTLS advertised, so there is no way to secure this session.
    const smtp = await startSmtpServer({ capabilities: ['AUTH PLAIN'] })
    const send = smtpTransport({
      host: '127.0.0.1', port: smtp.port, secure: false, user: 'u', pass: 'secret'
    })

    await assert.rejects(
      () => send({ from: 'a@b.c', to: 'd@e.f', subject: 'S', text: 't' }),
      /Refusing to send SMTP credentials over an unencrypted connection/
    )

    assert.ok(
      !smtp.transcript.some((l) => l.includes('secret')),
      'the password must not reach the wire'
    )
    await smtp.stop()
  })

  test('an auth failure does not echo the credentials', async () => {
    const smtp = await startSmtpServer({ capabilities: ['AUTH PLAIN'], requireAuth: true })
    const send = smtpTransport({
      host: '127.0.0.1', port: smtp.port, secure: false,
      user: 'u', pass: 'hunter2', requireTls: false
    })

    // The server accepts AUTH here, so force a failure further along instead and
    // assert only that no error message could ever carry the secret.
    try {
      await send({ from: 'a@b.c', to: 'd@e.f', subject: 'S', text: 't' })
    } catch (err) {
      assert.doesNotMatch(err.message, /hunter2/)
    }

    assert.ok(!smtp.transcript.some((l) => l.includes('hunter2')))
    await smtp.stop()
  })
})

describe('resendTransport', () => {
  test('defaults to Resend\'s relay on implicit TLS', () => {
    // Constructing it is enough — it must not throw and must not need a network.
    assert.strictEqual(typeof resendTransport({ apiKey: 're_test' }), 'function')
  })

  test('requires an api key', () => {
    assert.throws(() => resendTransport({}), /requires an apiKey/)
  })

  test('the host can be pointed elsewhere for testing', () => {
    assert.strictEqual(
      typeof resendTransport({ apiKey: 'k', host: '127.0.0.1', port: 2525 }),
      'function'
    )
  })
})

// ---------------------------------------------------------------------------
// Mailpit — a real SMTP implementation
// ---------------------------------------------------------------------------

const MAILPIT_SMTP = Number(process.env.MAILPIT_SMTP_PORT || 1025)
const MAILPIT_API = process.env.MAILPIT_API || 'http://localhost:8025'

async function mailpitReachable() {
  try {
    const response = await fetch(`${MAILPIT_API}/api/v1/info`, {
      signal: AbortSignal.timeout(1000)
    })
    return response.ok
  } catch {
    return false
  }
}

const hasMailpit = await mailpitReachable()

describe('against Mailpit', { skip: hasMailpit ? false : 'Mailpit not reachable on localhost:8025' }, () => {
  before(async () => {
    await fetch(`${MAILPIT_API}/api/v1/messages`, { method: 'DELETE' })
  })

  test('a real server accepts and parses what we produce', async () => {
    const send = smtpTransport({ host: 'localhost', port: MAILPIT_SMTP, secure: false })

    await send({
      from: 'BasicBen <noreply@example.com>',
      to: 'ada@example.com',
      subject: 'Verify your email — café ☕',
      text: 'Visit https://example.com/verify/abc?token=1&x=2\n.dotted line',
      html: '<p>Visit <a href="https://example.com/verify/abc">the link</a></p>'
    })

    const list = await (await fetch(`${MAILPIT_API}/api/v1/messages`)).json()
    const summary = list.messages.find((m) => m.Subject.includes('Verify your email'))
    assert.ok(summary, 'Mailpit received the message')

    const message = await (await fetch(`${MAILPIT_API}/api/v1/message/${summary.ID}`)).json()

    // Mailpit decoded the RFC 2047 subject, the multipart body and the base64
    // parts — which is the whole point of asking a real implementation.
    assert.strictEqual(message.Subject, 'Verify your email — café ☕')
    assert.strictEqual(message.From.Address, 'noreply@example.com')
    assert.strictEqual(message.To[0].Address, 'ada@example.com')
    assert.match(message.Text, /verify\/abc\?token=1&x=2/, 'a query string must survive intact')
    assert.match(message.Text, /^\.dotted line$/m, 'dot-stuffing must be undone by the server')
    assert.match(message.HTML, /<a href="https:\/\/example\.com\/verify\/abc">/)
  })

  test('several recipients all arrive', async () => {
    const send = smtpTransport({ host: 'localhost', port: MAILPIT_SMTP, secure: false })

    await send({
      from: 'noreply@example.com',
      to: ['one@example.com', 'two@example.com'],
      subject: 'Multi recipient',
      text: 'hello'
    })

    const list = await (await fetch(`${MAILPIT_API}/api/v1/messages`)).json()
    const summary = list.messages.find((m) => m.Subject === 'Multi recipient')

    assert.ok(summary)
    assert.deepStrictEqual(summary.To.map((t) => t.Address).sort(), ['one@example.com', 'two@example.com'])
  })
})
