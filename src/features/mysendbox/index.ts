/**
 * Newsletters through MySendbox (mysendbox.com).
 *
 * With `MYSENDBOX_API_KEY` set, members become MySendbox contacts in one
 * audience, and a post sent as a newsletter becomes a MySendbox broadcast
 * instead of going through the members feature's own queue. MySendbox does
 * the batching, pacing, retries, suppression and unsubscribes, so a site on
 * a serverless host needs no frequent cron for newsletters.
 *
 * Needs the members feature (it listens to members' hooks; it imports
 * nothing of it). Without a key it registers only its settings and a health
 * check, and members sends as before. Remove this folder and its lines in
 * src/features.ts, src/client/features.ts and src/features.manifest.ts, and
 * members sends through its own queue again. How it works: README.md.
 */

import type { Feature } from '../../host/index.ts'
import { check } from '../../helpers/health.ts'
import { SETTINGS, isConfigured, webhookSecret } from './config.ts'
import { mysendboxRoutes } from './routes.ts'
import { MEMBER_EVENTS, onMemberCreated, onMemberUpdated, onMemberDeleted, syncDirty, pullUnsubscribes } from './contacts.ts'
import { DELIVERING_HOOK, STATUS_HOOK, deliverAsBroadcast, describeSend } from './broadcasts.ts'

const mysendbox: Feature = {
  name: 'mysendbox',

  register(host) {
    host.settings.define(SETTINGS)

    host.health.check('setup', async ({ db }) => {
      if (!isConfigured()) {
        return check('mysendbox', 'MySendbox', 'pass', 'Not set up: newsletters go through the built-in queue.',
          'Set MYSENDBOX_API_KEY to send newsletters through MySendbox.')
      }

      const results = []
      try {
        const rows = (await db.all(
          "SELECT state, COUNT(*) AS n FROM mysendbox_contacts WHERE state IN ('refused', 'needs_consent') OR (state = 'dirty' AND attempts > 0) GROUP BY state"
        )) as Array<{ state: string; n: number }>
        const of = (state: string) => Number(rows.find((r) => r.state === state)?.n) || 0
        const waiting = of('needs_consent')
        const refused = of('refused')
        const failing = of('dirty')

        results.push(
          failing
            ? check('mysendbox_contacts', 'MySendbox contacts', 'warn', `${failing} member(s) could not be copied to MySendbox yet and will be retried.`, 'The MySendbox settings card lists why.')
            : waiting || refused
              ? check('mysendbox_contacts', 'MySendbox contacts', 'warn',
                `${waiting} member(s) wait for a consent attestation or a signup form; MySendbox refused ${refused}.`,
                'Added and imported members need a consent attestation or a signup form in the MySendbox settings.')
              : check('mysendbox_contacts', 'MySendbox contacts', 'pass', 'Every member is in step with MySendbox.')
        )

        const stuck = await db.get("SELECT COUNT(*) AS n, MAX(handoff_error) AS error FROM newsletter_sends WHERE status = 'handoff_failed'")
        results.push(
          Number(stuck?.n)
            ? check('mysendbox_sends', 'MySendbox broadcasts', 'fail', `${stuck.n} newsletter(s) are waiting to be handed to MySendbox: ${stuck.error ?? ''}`.trim(),
              'They are retried every ten minutes the cron tick runs. They are never sent by the built-in queue instead.')
            : check('mysendbox_sends', 'MySendbox broadcasts', 'pass', 'No newsletter is waiting to be handed off.')
        )
      } catch {
        return null
      }

      if (!webhookSecret()) {
        results.push(check('mysendbox_webhook', 'MySendbox webhook', 'warn', 'No MYSENDBOX_WEBHOOK_SECRET: unsubscribes in MySendbox reach the CMS only through the daily check.',
          'Add a webhook in MySendbox for contact.updated and contact.erased pointing at /api/webhooks/mysendbox, and set its secret.'))
      }
      return results
    })

    host.routes(mysendboxRoutes)

    if (!isConfigured()) return

    host.hooks.on(MEMBER_EVENTS.CREATED, onMemberCreated, { name: 'mysendbox:member-created' })
    host.hooks.on(MEMBER_EVENTS.UPDATED, onMemberUpdated, { name: 'mysendbox:member-updated' })
    host.hooks.on(MEMBER_EVENTS.DELETED, onMemberDeleted, { name: 'mysendbox:member-deleted' })
    host.hooks.on(DELIVERING_HOOK, deliverAsBroadcast, { name: 'mysendbox:deliver' })
    host.hooks.on(STATUS_HOOK, describeSend, { name: 'mysendbox:status' })

    // Daily is enough: syncs run right after each change and before every
    // broadcast; this catches what a frozen serverless function dropped, and
    // the unsubscribes a missed webhook didn't bring.
    host.cron.task('reconcile', 6 * 3600, async () => ({
      synced: await syncDirty(500, { includeExhausted: true }),
      unsubscribes: await pullUnsubscribes()
    }))
  }
}

export default mysendbox
