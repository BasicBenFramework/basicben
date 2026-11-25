/**
 * Encryption for secrets kept in site settings (storage keys, API keys).
 *
 * AES-256-GCM under a key derived from APP_KEY. A stored value reads
 * `enc:v1:<iv>.<tag>.<ciphertext>` (base64url). GCM authenticates as well as
 * encrypts, so a value edited in the database, or written under another
 * APP_KEY, fails to decrypt rather than decrypting to garbage.
 *
 * Changing APP_KEY therefore loses these settings: `decryptSecret` returns
 * null, the Configuration screen shows them as unreadable, and they have to be
 * entered again. That is the trade for not keeping a second key.
 *
 * Imports nothing outside `node:` so the tests load it directly.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const PREFIX = 'enc:v1:'

function key(appKey: string): Buffer {
  // A label, so this key is never the same bytes as anything else APP_KEY signs.
  return createHash('sha256').update(`basicben-cms settings v1\0${appKey}`).digest()
}

function appKeyOrThrow(appKey = process.env.APP_KEY): string {
  if (!appKey) throw new Error('APP_KEY is required to store a secret setting')
  return appKey
}

export function isEncrypted(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX)
}

export function encryptSecret(plain: string, appKey?: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(appKeyOrThrow(appKey)), iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return PREFIX + [iv, tag, body].map((part) => part.toString('base64url')).join('.')
}

/** The plain value, or null when it cannot be read (another APP_KEY, edited, not encrypted). */
export function decryptSecret(stored: string | null | undefined, appKey = process.env.APP_KEY): string | null {
  if (!stored || !appKey || !isEncrypted(stored)) return null

  const parts = stored.slice(PREFIX.length).split('.')
  if (parts.length !== 3) return null

  try {
    const [iv, tag, body] = parts.map((part) => Buffer.from(part, 'base64url'))
    const decipher = createDecipheriv('aes-256-gcm', key(appKey), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
