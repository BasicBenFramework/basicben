/**
 * `POST /api/webhooks/mysendbox`: MySendbox telling the CMS a contact's
 * subscription changed (`contact.updated`) or the contact was erased
 * (`contact.erased`).
 *
 * - **Verified** with the `MySendbox-Signature` header: `t=<unix seconds>,
 *   v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`, refused when the time is
 *   more than five minutes off. Over the raw body, which is why
 *   `/api/webhooks/` is left unparsed (basicben.config.js).
 * - **404 without `MYSENDBOX_WEBHOOK_SECRET`**, as the cron routes do with no
 *   secret: an endpoint that can't verify anything should not exist.
 * - **Repeats and reordering are harmless.** Applying a status twice changes
 *   nothing, and each contact's last-heard time (`remote_at`) means an older
 *   event delivered late cannot undo a newer one.
 * - Any other event type is acknowledged and ignored, so a webhook that
 *   subscribes to everything (`*`) does no harm.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { webhookSecret, setting } from './config.ts'
import { applyRemoteStatus } from './contacts.ts'
import type { Request, Response } from '../../types/index.ts'

export const MAX_BODY_BYTES = 256 * 1024
export const TOLERANCE_SECONDS = 5 * 60

/** Read the request stream ourselves: the body parser skipped it. */
function readRaw(req: any): Promise<string> {
  // Already parsed by something else (a test, or a server without the skip):
  // there is nothing to verify against.
  if (typeof req.rawBody === 'string') return Promise.resolve(req.rawBody)
  if (typeof req.on !== 'function') return Promise.reject(new Error('no body'))

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('too large'))
        req.destroy?.()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Is this the signature MySendbox would make for this body now? */
export function verifySignature(secret: string, body: string, header: unknown, nowMs = Date.now()): boolean {
  if (!secret || typeof header !== 'string') return false

  const parts = Object.fromEntries(
    header.split(',').map((part) => {
      const at = part.indexOf('=')
      return [part.slice(0, at).trim(), part.slice(at + 1).trim()]
    })
  )
  const t = Number(parts.t)
  const given = String(parts.v1 ?? '')
  if (!Number.isFinite(t) || Math.abs(nowMs / 1000 - t) > TOLERANCE_SECONDS) return false
  if (!/^[0-9a-f]{64}$/i.test(given)) return false

  const expected = createHmac('sha256', secret).update(`${parts.t}.${body}`).digest('hex')
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(given, 'hex'))
}

export async function mysendboxWebhook(req: Request, res: Response) {
  const secret = webhookSecret()
  if (!secret) return res.json({ error: 'Not found' }, 404)

  let raw: string
  try {
    raw = await readRaw(req)
  } catch {
    return res.json({ error: 'Unreadable body' }, 400)
  }

  if (!verifySignature(secret, raw, req.headers['mysendbox-signature'])) {
    return res.json({ error: 'Bad signature' }, 401)
  }

  let event: { type?: string; data?: Record<string, any> }
  try {
    event = JSON.parse(raw)
  } catch {
    return res.json({ error: 'Not JSON' }, 400)
  }

  const data = event?.data ?? {}
  const memberId = Number(data.attributes?.cms_member_id) || null

  if (event?.type === 'contact.updated' && typeof data.status === 'string') {
    // Leaving one list on the preferences page, with the status unchanged,
    // matters only if it is this site's list: then they've left it.
    const status = data.change === 'audience_left' ? 'unsubscribed' : data.status
    if (data.change === 'audience_left' && !(await isOurAudience(data.audience?.id))) return res.json({ ok: true })

    const result = await applyRemoteStatus({ contactId: data.contactId, email: data.email, memberId, status, at: Number(data.at) || null })
    return res.json({ ok: true, result })
  }

  if (event?.type === 'contact.erased') {
    const result = await applyRemoteStatus({ contactId: data.contactId, email: data.email, memberId, status: 'erased', at: Number(data.at) || null })
    return res.json({ ok: true, result })
  }

  res.json({ ok: true, ignored: event?.type ?? null })
}

async function isOurAudience(id: unknown): Promise<boolean> {
  return typeof id === 'string' && id !== '' && id === (await setting('mysendbox_audience_id'))
}
