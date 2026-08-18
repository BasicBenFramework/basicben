/**
 * Presigned direct uploads.
 *
 * The browser PUTs straight to the bucket; the server only signs a URL and
 * records a row. File bytes never pass through Node.
 *
 * This replaces the multipart parser rather than repairing it, and in doing so
 * removes four problems at once: the global body parser draining and corrupting
 * the upload before the controller ran, the 1 MB body limit contradicting the
 * advertised 10 MB, buffering whole files in memory before checking their size,
 * and uploads landing outside the directory production actually serves.
 *
 * ## Two things a presigned URL does not give you
 *
 * **It does not cap the upload size.** A presigned PUT will accept a gigabyte
 * from a URL issued for a thumbnail. The declared size is checked at signing
 * time, which stops the honest case, and `confirmUpload` then HEADs the stored
 * object and deletes it if it came back larger. Believing the declared size
 * alone is what makes an upload endpoint a disk-filling tool.
 *
 * **It does not tell you who uploaded what.** The key travels to the browser
 * and comes back at confirm time, so a caller could confirm a key it never
 * uploaded — claiming someone else's object as its own media row. Each signed
 * upload therefore carries a ticket: an HMAC over the key, the owner and the
 * expiry, checked before anything is written. It is stateless, so it costs no
 * table and no cleanup.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { getStorage, buildKey, sanitizeFilename } from './index.js'
import { hooks, HOOKS } from '../hooks/index.js'

/** Types accepted by default. */
export const DEFAULT_ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
  'application/pdf',
  'text/plain', 'text/markdown', 'text/csv',
  'video/mp4', 'video/webm',
  'audio/mpeg', 'audio/ogg', 'audio/wav'
]

/**
 * Types never accepted, whatever the allowlist says.
 *
 * A bucket served from a domain will happily hand a browser an HTML or SVG file
 * with the content type it was stored under, and that is same-origin script
 * execution. SVG is an image everywhere except in the way that matters here.
 */
const NEVER_ALLOWED = [
  'text/html', 'application/xhtml+xml', 'image/svg+xml',
  'application/xml', 'text/xml',
  'application/javascript', 'text/javascript', 'application/x-javascript',
  'application/x-httpd-php', 'application/x-sh', 'text/x-sh'
]

const DEFAULT_MAX_SIZE = 10 * 1024 * 1024

/**
 * Validate an upload before signing anything.
 *
 * This is the enforcement point: a caller with no signed URL cannot upload at
 * all, so refusing here is cheaper and more reliable than inspecting bytes
 * afterwards.
 *
 * @param {Object} upload
 * @param {string} upload.filename
 * @param {string} upload.contentType
 * @param {number} upload.size
 * @param {Object} [options]
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateUpload({ filename, contentType, size } = {}, options = {}) {
  const maxSize = options.maxSize ?? DEFAULT_MAX_SIZE
  const allowed = options.allowedTypes || DEFAULT_ALLOWED_TYPES

  if (!filename || typeof filename !== 'string') {
    return { valid: false, error: 'A filename is required.' }
  }

  if (!contentType || typeof contentType !== 'string') {
    return { valid: false, error: 'A content type is required.' }
  }

  // Compared without parameters: "image/png; charset=x" is still image/png.
  const type = contentType.split(';')[0].trim().toLowerCase()

  if (NEVER_ALLOWED.includes(type)) {
    return { valid: false, error: `Files of type ${type} cannot be uploaded.` }
  }

  if (!allowed.includes(type)) {
    return { valid: false, error: `Files of type ${type} are not allowed.` }
  }

  const declared = Number(size)

  if (!Number.isFinite(declared) || declared <= 0) {
    return { valid: false, error: 'A file size is required.' }
  }

  if (declared > maxSize) {
    return { valid: false, error: `Files must be ${formatBytes(maxSize)} or smaller.` }
  }

  return { valid: true, contentType: type }
}

/**
 * Issue a presigned upload URL.
 *
 * @param {Object} upload
 * @param {string} upload.filename
 * @param {string} upload.contentType
 * @param {number} upload.size
 * @param {number|string} [upload.userId] - bound into the ticket
 * @param {Object} [options]
 * @param {number} [options.expiresIn] - seconds
 * @param {string} [options.prefix]
 * @param {number} [options.maxSize]
 * @param {string[]} [options.allowedTypes]
 * @param {string} [options.secret]
 * @param {Object} [options.storage]
 * @returns {Promise<{
 *   ok: boolean,
 *   error?: string,
 *   uploadUrl?: string,
 *   key?: string,
 *   contentType?: string,
 *   ticket?: string,
 *   expiresAt?: string,
 *   headers?: Record<string, string>
 * }>} `headers` must be sent verbatim on the PUT — the signature covers the
 *   content type, so storage refuses anything else.
 */
export async function signUpload(upload, options = {}) {
  const check = validateUpload(upload, options)
  if (!check.valid) return { ok: false, error: check.error }

  const storage = options.storage || await getStorage()
  const expiresIn = options.expiresIn ?? 900

  const key = buildKey(sanitizeFilename(upload.filename), { prefix: options.prefix })

  // Plugins may rewrite the key or refuse the upload — image pipelines and
  // per-tenant prefixes both want a say before anything is signed.
  const filtered = await hooks.filter(HOOKS.MEDIA_UPLOADING, {
    key,
    filename: upload.filename,
    contentType: check.contentType,
    size: Number(upload.size),
    userId: upload.userId
  })

  if (filtered && filtered.cancel) {
    return { ok: false, error: filtered.reason || 'Upload rejected.' }
  }

  const finalKey = (filtered && filtered.key) || key
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn

  // The content type is bound into the signature, so a URL issued for a PNG
  // cannot be used to store an HTML file under a PNG name.
  const uploadUrl = storage.signedUrl(finalKey, {
    method: 'PUT',
    expiresIn,
    contentType: check.contentType
  })

  return {
    ok: true,
    uploadUrl,
    key: finalKey,
    contentType: check.contentType,
    ticket: issueTicket({ key: finalKey, userId: upload.userId, expiresAt, secret: options.secret }),
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    headers: { 'Content-Type': check.contentType }
  }
}

/**
 * Verify an upload actually happened, and is what it claimed to be.
 *
 * Everything here is checked against the bucket rather than against what the
 * caller says, because by this point the caller has been to the bucket and back
 * and every field it returns is attacker-controlled.
 *
 * @param {Object} confirmation
 * @param {string} confirmation.key
 * @param {string} confirmation.ticket
 * @param {number|string} [confirmation.userId]
 * @param {Object} [options]
 * @returns {Promise<{ ok: boolean, error?: string, key?: string, size?: number, contentType?: string, url?: string }>}
 */
export async function confirmUpload({ key, ticket, userId } = {}, options = {}) {
  if (!key || !ticket) return { ok: false, error: 'A key and ticket are required.' }

  const verified = verifyTicket({ key, userId, ticket, secret: options.secret })
  if (!verified.valid) {
    return { ok: false, error: verified.reason === 'expired' ? 'This upload has expired.' : 'Invalid upload ticket.' }
  }

  const storage = options.storage || await getStorage()
  const info = await storage.head(key)

  // No object means nothing was uploaded — confirming anyway would create a row
  // pointing at nothing, which the media library then renders as a broken image.
  if (!info) return { ok: false, error: 'No file was uploaded for this key.' }

  const maxSize = options.maxSize ?? DEFAULT_MAX_SIZE

  if (info.size > maxSize) {
    // The presigned URL could not enforce this, so it is enforced now — and the
    // oversized object is removed rather than left occupying the bucket.
    await storage.delete(key).catch(() => {})
    return { ok: false, error: `Files must be ${formatBytes(maxSize)} or smaller.` }
  }

  if (info.size === 0) {
    await storage.delete(key).catch(() => {})
    return { ok: false, error: 'The uploaded file was empty.' }
  }

  const result = {
    ok: true,
    key,
    size: info.size,
    contentType: info.contentType,
    etag: info.etag,
    url: storage.publicUrl(key)
  }

  await hooks.fire(HOOKS.MEDIA_UPLOADED, { ...result, userId })

  return result
}

/**
 * Remove an object and announce it.
 *
 * @param {string} key
 * @param {Object} [options]
 * @returns {Promise<void>}
 */
export async function deleteUpload(key, options = {}) {
  const storage = options.storage || await getStorage()

  await storage.delete(key)
  await hooks.fire(HOOKS.MEDIA_DELETED, { key, userId: options.userId })
}

/**
 * Mint an upload ticket.
 *
 * An HMAC over the key, the owner and the expiry. Stateless on purpose: a
 * pending-uploads table would need its own cleanup, and this needs none.
 */
function issueTicket({ key, userId, expiresAt, secret }) {
  const signature = ticketSignature({ key, userId, expiresAt, secret })
  return `${expiresAt}.${signature}`
}

/**
 * Check an upload ticket.
 *
 * @returns {{ valid: boolean, reason?: string }}
 */
export function verifyTicket({ key, userId, ticket, secret }) {
  if (typeof ticket !== 'string' || !ticket.includes('.')) return { valid: false, reason: 'malformed' }

  const separator = ticket.indexOf('.')
  const expiresAt = Number(ticket.slice(0, separator))
  const provided = ticket.slice(separator + 1)

  if (!Number.isFinite(expiresAt)) return { valid: false, reason: 'malformed' }
  if (expiresAt < Math.floor(Date.now() / 1000)) return { valid: false, reason: 'expired' }

  const expected = ticketSignature({ key, userId, expiresAt, secret })

  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(provided, 'hex')

  // Constant time: a comparison that returns early leaks how much of a guess
  // was right, which is enough to recover the signature byte by byte.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: 'signature' }
  }

  return { valid: true }
}

function ticketSignature({ key, userId, expiresAt, secret }) {
  const material = secret || process.env.APP_KEY || 'basicben-upload-ticket'

  return createHmac('sha256', material)
    .update(`${key}\n${userId ?? ''}\n${expiresAt}`)
    .digest('hex')
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} bytes`
}
