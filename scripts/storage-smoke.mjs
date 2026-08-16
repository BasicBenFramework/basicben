/**
 * Storage smoke test.
 *
 * Drives the real upload flow against a booted app: sign, PUT straight to
 * storage, confirm, list, delete. Unit tests pass on every failure this catches,
 * because the failures are in the wiring rather than in the logic — a body
 * parser that eats the request, a route that was never registered, a key stored
 * where nothing serves it.
 *
 * Runs against whichever driver the app is configured for, so the same script
 * exercises the local disk in CI and MinIO when one is reachable.
 *
 * Usage: node scripts/storage-smoke.mjs <baseUrl> <token>
 */

const BASE = process.argv[2] || 'http://localhost:3987'
const TOKEN = process.argv[3]

if (!TOKEN) {
  console.error('usage: storage-smoke.mjs <baseUrl> <token>')
  process.exit(2)
}

let failures = 0
const pass = (message) => console.log(`\x1b[32m✓\x1b[0m ${message}`)
const fail = (message, detail) => {
  console.log(`\x1b[31m✗\x1b[0m ${message}${detail ? `\n  ${detail}` : ''}`)
  failures++
}

const api = async (path, options = {}) => {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
      ...options.headers
    }
  })

  const text = await response.text()
  let body

  try {
    body = JSON.parse(text)
  } catch {
    body = { raw: text.slice(0, 200) }
  }

  return { status: response.status, body }
}

// --- A signed URL is issued ---------------------------------------------------

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

const signed = await api('/api/media/sign', {
  method: 'POST',
  body: JSON.stringify({ filename: 'smoke test.png', contentType: 'image/png', size: PNG.length })
})

if (signed.status !== 200 || !signed.body.uploadUrl) {
  fail('sign returns an upload URL', JSON.stringify(signed.body))
  process.exit(1)
}

pass('sign returns an upload URL')

if (signed.body.key?.includes(' ')) fail('the key is sanitized', signed.body.key)
else pass('the key is sanitized')

if (!signed.body.ticket) fail('sign returns a ticket')
else pass('sign returns a ticket')

// --- Refusals happen before signing ------------------------------------------

for (const [label, payload] of [
  ['HTML is refused', { filename: 'x.html', contentType: 'text/html', size: 10 }],
  ['SVG is refused', { filename: 'x.svg', contentType: 'image/svg+xml', size: 10 }],
  ['JavaScript is refused', { filename: 'x.js', contentType: 'application/javascript', size: 10 }],
  ['an oversized file is refused', { filename: 'x.png', contentType: 'image/png', size: 999_999_999 }],
  ['a missing size is refused', { filename: 'x.png', contentType: 'image/png' }]
]) {
  const result = await api('/api/media/sign', { method: 'POST', body: JSON.stringify(payload) })

  if (result.status === 200) fail(label, JSON.stringify(result.body))
  else pass(label)
}

// --- The browser PUTs straight to storage ------------------------------------

const uploadUrl = signed.body.uploadUrl.startsWith('http')
  ? signed.body.uploadUrl
  : `${BASE}${signed.body.uploadUrl}`

const put = await fetch(uploadUrl, {
  method: 'PUT',
  headers: signed.body.headers,
  body: PNG
})

if (!put.ok) {
  fail('the browser can PUT to the signed URL', `${put.status} ${(await put.text()).slice(0, 200)}`)
} else {
  pass('the browser can PUT to the signed URL')
}

// --- Confirm is checked against storage, not the caller ----------------------

const forged = await api('/api/media/confirm', {
  method: 'POST',
  body: JSON.stringify({ key: signed.body.key, ticket: 'forged.0000', filename: 'x.png' })
})

if (forged.status === 201) fail('a forged ticket is refused')
else pass('a forged ticket is refused')

const otherKey = await api('/api/media/confirm', {
  method: 'POST',
  body: JSON.stringify({ key: 'media/somebody/else.png', ticket: signed.body.ticket, filename: 'x.png' })
})

if (otherKey.status === 201) fail('a ticket cannot confirm another key')
else pass('a ticket cannot confirm another key')

const confirmed = await api('/api/media/confirm', {
  method: 'POST',
  body: JSON.stringify({ key: signed.body.key, ticket: signed.body.ticket, filename: 'smoke test.png' })
})

if (confirmed.status !== 201 || !confirmed.body.media) {
  fail('confirm records the upload', JSON.stringify(confirmed.body))
  process.exit(1)
}

pass('confirm records the upload')

if (confirmed.body.media.size !== PNG.length) {
  fail('the recorded size is the real one', `${confirmed.body.media.size} vs ${PNG.length}`)
} else {
  pass('the recorded size is the real one')
}

if (!confirmed.body.media.url) fail('the media row carries a URL')
else pass('the media row carries a URL')

// --- Confirming an upload that never happened --------------------------------

const ghost = await api('/api/media/sign', {
  method: 'POST',
  body: JSON.stringify({ filename: 'ghost.png', contentType: 'image/png', size: 100 })
})

const ghostConfirm = await api('/api/media/confirm', {
  method: 'POST',
  body: JSON.stringify({ key: ghost.body.key, ticket: ghost.body.ticket, filename: 'ghost.png' })
})

if (ghostConfirm.status === 201) fail('confirming a file that was never uploaded is refused')
else pass('confirming a file that was never uploaded is refused')

// --- The library lists it ----------------------------------------------------

const list = await api('/api/media')
const found = (list.body.media || []).find((item) => item.id === confirmed.body.media.id)

if (!found) fail('the upload appears in the media library', JSON.stringify(list.body).slice(0, 200))
else pass('the upload appears in the media library')

if (found && !found.url) fail('listed media carry URLs')
else pass('listed media carry URLs')

// --- And deleting removes it -------------------------------------------------

const removed = await api(`/api/media/${confirmed.body.media.id}`, { method: 'DELETE' })

if (removed.status !== 200) fail('delete removes the media row', JSON.stringify(removed.body))
else pass('delete removes the media row')

const afterDelete = await api('/api/media')
if ((afterDelete.body.media || []).some((item) => item.id === confirmed.body.media.id)) {
  fail('the row is gone after deletion')
} else {
  pass('the row is gone after deletion')
}

console.log('')
process.exit(failures === 0 ? 0 : 1)
