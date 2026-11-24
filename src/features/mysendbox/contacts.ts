/**
 * Members to MySendbox contacts, by state.
 *
 * A member change marks the member's row in `mysendbox_contacts` dirty;
 * `syncMember` then reads the member as it is *now* and makes MySendbox
 * match. So a lost event costs a delay, not a difference, and syncing twice
 * does nothing the second time. Dirty rows are synced in the background right
 * away, again before every broadcast, and by the daily reconcile.
 *
 * The members table is read directly (it is a core migration, and stays when
 * the members feature is removed). Writes to members go through the members
 * feature's `newsletter.subscription` hook, never to its table.
 *
 * ## Consent
 *
 * MySendbox keeps a consent record per contact. A member is copied as
 * subscribed only when the CMS knows how they agreed:
 *
 * - they signed up themselves (`source = signup`), or ticked "send me posts"
 *   themselves later, with a confirmed address;
 * - or an admin added or imported them and the site has a consent attestation
 *   (`mysendbox_consent_attestation`), the admin's own words.
 *
 * Otherwise, with a signup form set (`mysendbox_form_id`), they get MySendbox's
 * double opt-in mail; and with neither they are left out (`needs_consent`)
 * and the health page counts them.
 *
 * MySendbox decides unsubscribes. Someone who unsubscribed there can only
 * subscribe again through a MySendbox form, so the CMS never re-adds them
 * (MySendbox answers 409; the row is `refused`).
 */

import { getDb } from '@basicbenframework/core/db'
import { hooks } from '@basicbenframework/core/hooks'
import { Settings } from '../../models/Settings.ts'
import { client, audienceId, setting } from './config.ts'
import type { Result } from './client.ts'

/** The members feature's names, spelled out: features don't import each other. Checked by mysendbox.test.js. */
export const MEMBER_EVENTS = {
  CREATED: 'member.created',
  UPDATED: 'member.updated',
  DELETED: 'member.deleted'
} as const
export const SUBSCRIPTION_HOOK = 'newsletter.subscription'

export const PROVIDER = 'mysendbox'

/** Tries before a sync failure that MySendbox called temporary stops being retried by every caller but the daily task. */
export const MAX_ATTEMPTS = 5

interface MemberRow {
  id: number
  email: string
  name: string | null
  status: 'active' | 'unsubscribed'
  source: 'signup' | 'admin' | 'import'
  email_verified_at: string | null
  created_at: string
}

export interface ContactRow {
  member_id: number
  email: string | null
  contact_id: string | null
  consent: string | null
  remote_status: string | null
  remote_at: number | null
  state: 'dirty' | 'synced' | 'erase' | 'needs_consent' | 'refused'
  attempts: number
  last_error: string | null
}

const now = () => new Date().toISOString()

async function rowFor(memberId: number): Promise<ContactRow | undefined> {
  const db = await getDb()
  return db.get('SELECT * FROM mysendbox_contacts WHERE member_id = ?', [memberId])
}

/** Make sure the member has a row, and mark it for syncing. `consent`, when given, is kept. */
export async function markDirty(memberId: number, { consent, erase = false }: { consent?: string; erase?: boolean } = {}): Promise<void> {
  const db = await getDb()
  const state = erase ? 'erase' : 'dirty'
  const existing = await rowFor(memberId)

  if (existing) {
    await db.run(
      'UPDATE mysendbox_contacts SET state = ?, attempts = 0, consent = COALESCE(?, consent), updated_at = ? WHERE member_id = ?',
      [state, consent ?? null, now(), memberId]
    )
  } else {
    await db.run(
      'INSERT INTO mysendbox_contacts (member_id, state, consent, attempts, updated_at) VALUES (?, ?, ?, 0, ?)',
      [memberId, state, consent ?? null, now()]
    )
  }
}

async function save(memberId: number, changes: Partial<ContactRow> & { synced?: boolean }): Promise<void> {
  const db = await getDb()
  const { synced, ...fields } = changes
  const keys = Object.keys(fields)
  const sets = keys.map((k) => `${k} = ?`)
  const params: unknown[] = keys.map((k) => (fields as Record<string, unknown>)[k])
  if (synced) { sets.push('synced_at = ?'); params.push(now()) }
  sets.push('updated_at = ?'); params.push(now())
  await db.run(`UPDATE mysendbox_contacts SET ${sets.join(', ')} WHERE member_id = ?`, [...params, memberId])
}

/** A MySendbox refusal or outage, recorded on the row. Temporary ones stay dirty and are retried. */
async function failed(memberId: number, row: ContactRow, result: Extract<Result<unknown>, { ok: false }>): Promise<'dirty' | 'refused'> {
  const state = result.retry ? 'dirty' : 'refused'
  await save(memberId, { state, attempts: Number(row.attempts) + 1, last_error: result.error.slice(0, 500) })
  return state
}

/** How this member agreed, or what to do instead. */
async function consentFor(member: MemberRow, row: ContactRow, siteName: string):
  Promise<{ confirmed: string } | { form: string } | { none: string }> {
  if (member.source === 'signup' || row.consent) {
    if (!member.email_verified_at) return { none: 'Waiting for the member to confirm their address.' }
    return {
      confirmed: row.consent || `Signed up for ${siteName} with this address and confirmed it by an emailed link (${member.created_at}).`
    }
  }

  const attestation = await setting('mysendbox_consent_attestation')
  if (attestation) return { confirmed: `Added to ${siteName} by its admin (${member.source}). The admin's attestation: ${attestation}`.slice(0, 2000) }

  const form = await setting('mysendbox_form_id')
  if (form) return { form }

  return { none: 'Added by an admin or imported, with no consent attestation or signup form set in the MySendbox settings.' }
}

/**
 * Make MySendbox match this member. Returns the row's state afterwards.
 * Never throws for MySendbox's answers; throws only when the database does.
 */
export async function syncMember(memberId: number): Promise<ContactRow['state'] | 'gone'> {
  const db = await getDb()
  const row = await rowFor(memberId)
  if (!row) return 'gone'

  const member = (await db.get(
    'SELECT id, email, name, status, source, email_verified_at, created_at FROM members WHERE id = ?',
    [memberId]
  )) as MemberRow | undefined
  const api = client()

  // Deleted in the CMS: erased in MySendbox too. Deleting a member is the
  // admin's "forget this person", and MySendbox's erase is the same request.
  if (!member || row.state === 'erase') {
    if (row.contact_id) {
      const erased = await api.eraseContact(row.contact_id)
      if (!erased.ok && erased.status !== 404) return failed(memberId, row, erased)
    }
    if (!member) {
      await db.run('DELETE FROM mysendbox_contacts WHERE member_id = ?', [memberId])
      return 'gone'
    }
    await save(memberId, { contact_id: null, remote_status: 'erased', state: 'synced', last_error: null, synced: true })
    return 'synced'
  }

  // A new address is a new contact (MySendbox can't change a contact's
  // address); the old one stops getting mail.
  if (row.contact_id && row.email && row.email !== member.email) {
    const stopped = await api.unsubscribeContact(row.contact_id, 'The member changed their address in the CMS.')
    if (!stopped.ok && stopped.status !== 404) return failed(memberId, row, stopped)
    await save(memberId, { contact_id: null, remote_status: null })
    row.contact_id = null
    row.remote_status = null
  }

  if (member.status !== 'active') {
    if (row.contact_id && row.remote_status !== 'unsubscribed' && row.remote_status !== 'erased') {
      const stopped = await api.unsubscribeContact(row.contact_id, 'Unsubscribed in the CMS.')
      if (!stopped.ok && stopped.status !== 404) return failed(memberId, row, stopped)
      await save(memberId, { remote_status: 'unsubscribed', remote_at: Date.now() })
    }
    await save(memberId, { email: member.email, state: 'synced', last_error: null, attempts: 0, synced: true })
    return 'synced'
  }

  const siteName = (await Settings.getSiteName()) || 'this site'
  const consent = await consentFor(member, row, siteName)

  if ('none' in consent) {
    await save(memberId, { email: member.email, state: 'needs_consent', last_error: consent.none })
    return 'needs_consent'
  }

  let audience: string
  try {
    audience = await audienceId()
  } catch (err) {
    return failed(memberId, row, { ok: false, status: 0, error: (err as Error).message, retry: true })
  }

  if ('form' in consent) {
    // Once: a second call would send a second confirmation mail.
    if (row.contact_id) {
      await save(memberId, { email: member.email, state: 'synced', last_error: null, synced: true })
      return 'synced'
    }
    const asked = await api.subscribeThroughForm(consent.form, { email: member.email, name: member.name })
    if (!asked.ok) return failed(memberId, row, asked)
    await save(memberId, {
      email: member.email,
      contact_id: asked.data?.contact?.id ?? null,
      remote_status: asked.data?.contact?.status ?? 'pending',
      remote_at: Date.now(),
      state: 'synced',
      attempts: 0,
      last_error: null,
      synced: true
    })
    return 'synced'
  }

  const added = await api.upsertContact({
    email: member.email,
    name: member.name,
    audienceIds: [audience],
    attributes: { cms_member_id: member.id },
    consent: consent.confirmed,
    confirmed: true
  })

  if (!added.ok) {
    // 409: they unsubscribed (or were erased) in MySendbox, and only they
    // can undo that. The CMS follows MySendbox rather than fighting it.
    if (added.status === 409) {
      // Through a signup form, they can: its confirmation mail is MySendbox's
      // way of hearing it from them. Once per address, as above.
      const form = await setting('mysendbox_form_id')
      if (form && row.remote_status !== 'pending') {
        const asked = await api.subscribeThroughForm(form, { email: member.email, name: member.name })
        if (asked.ok) {
          await save(memberId, {
            email: member.email,
            contact_id: asked.data?.contact?.id ?? row.contact_id,
            remote_status: 'pending',
            remote_at: Date.now(),
            state: 'synced',
            attempts: 0,
            last_error: 'Asked to confirm by email: they had unsubscribed in MySendbox before.',
            synced: true
          })
          return 'synced'
        }
      }
      await save(memberId, { email: member.email, state: 'refused', attempts: Number(row.attempts) + 1, last_error: added.error.slice(0, 500) })
      await hooks.fire(SUBSCRIPTION_HOOK, { memberId, email: member.email, subscribed: false, provider: PROVIDER })
      return 'refused'
    }
    return failed(memberId, row, added)
  }

  await save(memberId, {
    email: member.email,
    contact_id: added.data?.id ?? row.contact_id,
    remote_status: added.data?.status ?? 'subscribed',
    remote_at: Date.now(),
    state: 'synced',
    attempts: 0,
    last_error: null,
    synced: true
  })
  return 'synced'
}

/** Sync up to `limit` dirty or erased rows, oldest change first. */
export async function syncDirty(limit = 100, { includeExhausted = false } = {}): Promise<Record<string, number>> {
  const db = await getDb()
  const rows = (await db.all(
    `SELECT member_id FROM mysendbox_contacts
     WHERE state IN ('dirty', 'erase') ${includeExhausted ? '' : 'AND attempts < ?'}
     ORDER BY updated_at ASC LIMIT ?`,
    includeExhausted ? [limit] : [MAX_ATTEMPTS, limit]
  )) as Array<{ member_id: number }>

  const outcome: Record<string, number> = {}
  for (const { member_id } of rows) {
    const state = await syncMember(Number(member_id))
    outcome[state] = (outcome[state] ?? 0) + 1
  }
  return outcome
}

let background = true

/** For tests: run syncs only when asked, so counts are deterministic. */
export function setBackgroundSync(on: boolean): void {
  background = on
}

/** Run a sync without the request waiting for it, and never let it throw. */
export function inBackground(job: () => Promise<unknown>): void {
  if (!background) return
  Promise.resolve().then(job).catch((err) => console.error('[mysendbox]', (err as Error)?.message ?? err))
}

// --- The member event listeners ----------------------------------------------

export async function onMemberCreated({ member }: { member?: MemberRow }): Promise<void> {
  if (!member?.id) return
  await markDirty(member.id)
  inBackground(() => syncMember(member.id))
}

export async function onMemberUpdated({ member, previous, origin }: { member?: MemberRow; previous?: MemberRow; origin?: string }): Promise<void> {
  if (!member?.id) return
  // Our own change coming back: MySendbox already has it.
  if (origin === PROVIDER) return

  // The member turning newsletters back on themselves is consent in its own right.
  const resubscribed = origin === 'member' && member.status === 'active' && previous?.status !== 'active'
  const consent = resubscribed ? `Turned newsletters on themselves in their ${new Date().toISOString().slice(0, 10)} account settings.` : undefined

  await markDirty(member.id, { consent })
  inBackground(() => syncMember(member.id))
}

export async function onMemberDeleted({ member }: { member?: MemberRow }): Promise<void> {
  if (!member?.id) return
  const row = await rowFor(member.id)
  // Never in MySendbox: nothing to erase.
  if (!row) return
  await markDirty(member.id, { erase: true })
  inBackground(() => syncMember(member.id))
}

/**
 * Copy members across: mark every member without a synced contact dirty, and
 * sync a batch. The admin's "Copy members to MySendbox" calls it until
 * `remaining` is 0. Safe to run any number of times.
 */
export async function backfill(batch = 50): Promise<{ done: Record<string, number>; remaining: number }> {
  const db = await getDb()
  await db.run(
    `INSERT INTO mysendbox_contacts (member_id, state, attempts, updated_at)
     SELECT m.id, 'dirty', 0, ? FROM members m
     WHERE m.status = 'active' AND NOT EXISTS (SELECT 1 FROM mysendbox_contacts c WHERE c.member_id = m.id)`,
    [now()]
  )
  // Ones that were waiting for consent get another look: the admin may just
  // have written an attestation or set a form.
  await db.run("UPDATE mysendbox_contacts SET state = 'dirty', attempts = 0 WHERE state = 'needs_consent'")

  const done = await syncDirty(batch)
  const left = await db.get("SELECT COUNT(*) AS n FROM mysendbox_contacts WHERE state IN ('dirty', 'erase') AND attempts < ?", [MAX_ATTEMPTS])
  return { done, remaining: Number(left?.n) || 0 }
}

/** Counts by state, for the settings card and the health page. */
export async function contactCounts(): Promise<Record<string, number>> {
  const db = await getDb()
  try {
    const rows = (await db.all('SELECT state, COUNT(*) AS n FROM mysendbox_contacts GROUP BY state')) as Array<{ state: string; n: number }>
    return Object.fromEntries(rows.map((r) => [r.state, Number(r.n) || 0]))
  } catch {
    return {}
  }
}

// --- MySendbox to the CMS --------------------------------------------------

const STOPPED = new Set(['unsubscribed', 'bounced', 'complained', 'cleaned'])

/**
 * A contact's status as MySendbox reports it (webhook or the daily pull).
 * The member follows, unless the CMS already heard something newer.
 */
export async function applyRemoteStatus(contact: {
  contactId?: string | null
  email?: string | null
  memberId?: number | null
  status: string
  at?: number | null
}): Promise<'applied' | 'stale' | 'unknown'> {
  const db = await getDb()
  const at = Number(contact.at) || Date.now()

  let row: ContactRow | undefined
  if (contact.contactId) row = await db.get('SELECT * FROM mysendbox_contacts WHERE contact_id = ?', [contact.contactId])
  if (!row && contact.memberId) row = await rowFor(contact.memberId)
  if (!row && contact.email) row = await db.get('SELECT * FROM mysendbox_contacts WHERE email = ?', [String(contact.email).toLowerCase()])
  if (!row) return 'unknown'
  if (row.remote_at && Number(row.remote_at) > at) return 'stale'

  await save(row.member_id, {
    remote_status: contact.status,
    remote_at: at,
    ...(contact.contactId && contact.status !== 'erased' ? { contact_id: contact.contactId } : {}),
    ...(contact.status === 'erased' ? { contact_id: null } : {})
  })

  if (STOPPED.has(contact.status) || contact.status === 'erased') {
    await hooks.fire(SUBSCRIPTION_HOOK, { memberId: row.member_id, subscribed: false, provider: PROVIDER })
  } else if (contact.status === 'subscribed') {
    await hooks.fire(SUBSCRIPTION_HOOK, { memberId: row.member_id, subscribed: true, provider: PROVIDER })
  }
  return 'applied'
}

/**
 * The daily backstop for missed webhooks: everyone MySendbox stopped mailing
 * in the site's audience, paged. Members still active here are unsubscribed.
 */
export async function pullUnsubscribes(maxPages = 20): Promise<{ checked: number; applied: number }> {
  const audience = await setting('mysendbox_audience_id')
  if (!audience) return { checked: 0, applied: 0 }

  const outcome = { checked: 0, applied: 0 }
  for (const status of STOPPED) {
    let before: string | undefined
    for (let page = 0; page < maxPages; page++) {
      const listed = await client().listContacts({ status, audience, before })
      if (!listed.ok) throw new Error(`MySendbox's contact list failed: ${listed.error}`)

      for (const contact of listed.data?.contacts ?? []) {
        outcome.checked++
        const memberId = Number(contact.attributes?.cms_member_id) || null
        // Not newer than what the CMS knows; `at` unknown, so only apply to
        // members whose row doesn't already say so.
        const db = await getDb()
        const row = (await db.get('SELECT remote_status FROM mysendbox_contacts WHERE contact_id = ?', [contact.id])) as { remote_status?: string } | undefined
        if (row?.remote_status === status) continue
        const done = await applyRemoteStatus({ contactId: contact.id, email: contact.email, memberId, status, at: Date.now() })
        if (done === 'applied') outcome.applied++
      }

      before = listed.data?.next ?? undefined
      if (!before) break
    }
  }
  return outcome
}
