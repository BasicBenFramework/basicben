/**
 * A post's newsletter as a MySendbox broadcast.
 *
 * The members feature hands the send over through its strict
 * `newsletter.delivering` filter (members/newsletter.ts, `handOffSend`): it
 * has already claimed the send, so only one caller is here at a time, but a
 * claim that was interrupted is retried. So each step is recorded before the
 * next, and a retry picks up where the last attempt stopped:
 *
 * 1. Bring contacts up to date (members who joined since the last sync).
 * 2. Create the broadcast, and record its id in `mysendbox_broadcasts` at
 *    once. MySendbox's broadcasts take no idempotency key, so this row is
 *    what stops a retry making a second one.
 * 3. Schedule it now, unless it already is (a retry after step 3).
 *
 * A crash between creating the broadcast and recording it leaves one unsent
 * draft in MySendbox: harmless, and visible in its dashboard. Nothing here
 * can send a post twice.
 *
 * Any failure throws, which the strict filter turns into `handoff_failed`
 * and a later retry. It never falls back to the built-in queue.
 */

import { getDb } from '@basicbenframework/core/db'
import { client, audienceId, setting } from './config.ts'
import { syncDirty, PROVIDER } from './contacts.ts'

export const DELIVERING_HOOK = 'newsletter.delivering'
export const STATUS_HOOK = 'newsletter.status'

/** The broadcast statuses after which MySendbox will not send it again. */
const UNDER_WAY = new Set(['scheduled', 'sending', 'paused', 'sent'])

interface Delivering {
  send: { id: number; post_id: number; subject?: string | null }
  post: { id: number; title: string; excerpt?: string | null }
  message: { subject?: string; html?: string; text?: string; from?: string; replyTo?: string }
  handledBy: string | null
  externalId: string | null
}

/** `"Name" <address>` → its parts. */
function splitFrom(from: string | undefined): { name: string | null; address: string | null } {
  const match = /^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/.exec(from ?? '')
  return match ? { name: match[1].trim() || null, address: match[2].trim() } : { name: null, address: from?.trim() || null }
}

export async function deliverAsBroadcast(value: Delivering): Promise<Delivering> {
  // Another provider took it first: not ours.
  if (!value || value.handledBy) return value

  const db = await getDb()
  const api = client()

  // People who joined since the last sync should get this one too.
  await syncDirty(500)

  const audience = await audienceId()

  const recorded = (await db.get('SELECT broadcast_id FROM mysendbox_broadcasts WHERE send_id = ?', [value.send.id])) as
    | { broadcast_id: string }
    | undefined
  let broadcastId = recorded?.broadcast_id

  if (!broadcastId) {
    const sender = splitFrom(value.message.from)
    const fromAddress = (await setting('mysendbox_from_address')) || null
    const fromName = (await setting('mysendbox_from_name')) || sender.name

    const created = await api.createBroadcast({
      name: `Post ${value.post.id}: ${value.post.title}`.slice(0, 200),
      subject: String(value.message.subject ?? value.post.title).slice(0, 300),
      preheader: value.post.excerpt ? String(value.post.excerpt).slice(0, 300) : null,
      html: String(value.message.html ?? ''),
      text: value.message.text ? String(value.message.text) : null,
      audienceId: audience,
      // Blank: the workspace's own default From in MySendbox.
      ...(fromAddress ? { fromAddress } : {}),
      ...(fromName ? { fromName } : {}),
      ...(value.message.replyTo ? { replyTo: String(value.message.replyTo) } : {})
    })
    if (!created.ok) throw new Error(`MySendbox refused the broadcast: ${created.error}`)
    if (!created.data?.id) throw new Error('MySendbox did not return a broadcast id')

    broadcastId = created.data.id
    await db.run('INSERT INTO mysendbox_broadcasts (send_id, broadcast_id, created_at) VALUES (?, ?, ?)', [
      value.send.id,
      broadcastId,
      new Date().toISOString()
    ])
  }

  // A retry after it was scheduled: leave it be.
  const current = recorded ? await api.getBroadcast(broadcastId) : null
  if (!current?.ok || !UNDER_WAY.has(current.data.status)) {
    if (current?.ok && current.data.status === 'canceled') {
      throw new Error('The broadcast was canceled in MySendbox; it will not be sent again from here.')
    }
    const scheduled = await api.scheduleNow(broadcastId)
    if (!scheduled.ok) throw new Error(`MySendbox would not start the broadcast: ${scheduled.error}`)
  }

  return { ...value, handledBy: PROVIDER, externalId: broadcastId }
}

/** The per-recipient states MySendbox counts; their sum is the broadcast's recipients. */
const RECIPIENT_STATES = ['queued', 'sending', 'sent', 'delivered', 'soft_bounced', 'bounced', 'complained', 'suppressed', 'skipped', 'failed', 'canceled']

const STATUS_LABELS: Record<string, string> = {
  draft: 'draft',
  scheduled: 'scheduled',
  sending: 'sending',
  paused: 'paused',
  sent: 'sent',
  canceled: 'canceled'
}

/** `newsletter.status`: what MySendbox says about a send it took. Never throws. */
export async function describeSend(value: { send?: { provider?: string | null; external_id?: string | null }; provider: unknown }) {
  const send = value?.send
  if (!send || send.provider !== PROVIDER || !send.external_id) return value

  const found = await client().getBroadcast(send.external_id).catch(() => null)
  if (!found?.ok) {
    return { ...value, provider: { name: 'MySendbox', status: 'unknown', done: false, note: 'MySendbox could not be reached for its counts.' } }
  }

  const stats = (found.data.stats ?? {}) as Record<string, number>
  const recipients = RECIPIENT_STATES.reduce((sum, key) => sum + (Number(stats[key]) || 0), 0)
  const delivered = Number(stats.delivered) || 0

  return {
    ...value,
    provider: {
      name: 'MySendbox',
      status: STATUS_LABELS[found.data.status] ?? found.data.status,
      done: found.data.status === 'sent' || found.data.status === 'canceled',
      counts: {
        recipients,
        delivered,
        opened: Number(stats.opened) || 0,
        clicked: Number(stats.clicked) || 0,
        bounced: (Number(stats.bounced) || 0) + (Number(stats.soft_bounced) || 0),
        unsubscribed: Number(stats.unsubscribed) || 0
      },
      note: 'MySendbox leaves out subscribers with no opens, clicks or new consent in six months.'
    }
  }
}
