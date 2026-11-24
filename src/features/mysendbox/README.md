# Newsletters through MySendbox

With `MYSENDBOX_API_KEY` set, the members feature's newsletters go through
[MySendbox](https://mysendbox.com) instead of its own queue:

- **Members become MySendbox contacts** in one audience, named after the site
  and made on first use.
- **A post sent as a newsletter becomes one MySendbox broadcast.** MySendbox
  does the batching, pacing, retries, suppression and unsubscribes.
- **Unsubscribes made in MySendbox come back** through a webhook, with a daily
  check as a backstop.

So a site on a serverless host needs no every-minute cron for newsletters.
A daily `GET /api/cron/tick` is enough (Vercel Hobby's one cron).

Needs the members feature. It listens to members' hooks and imports nothing
of it. Without a key it does nothing, and members sends as before. To remove
it, delete this folder and its lines in `src/features.ts`,
`src/client/features.ts` and `src/features.manifest.ts`.

## Setting it up

In MySendbox:

1. **Marketing must be on for the workspace.** It is early access. Until it is,
   every call answers 403 `marketing_off`, and the health page says so.
2. **An API key** with `contacts:read`, `contacts:write`, `broadcasts:read` and
   `broadcasts:write`, and no domain or mailbox limits.
3. **A sending address** that marketing may use. Leave the From address blank
   here to use the workspace's default.
4. **A webhook** for `contact.updated` and `contact.erased`, pointed at
   `https://<this app>/api/webhooks/mysendbox`. Keep its `whsec_…` secret.

Here:

1. Set `MYSENDBOX_API_KEY` and `MYSENDBOX_WEBHOOK_SECRET`, and restart.
2. In **Settings**, fill the **Newsletters through MySendbox** card. Write the
   consent attestation if you have members you added or imported (see below).
3. Click **Copy members to MySendbox**, and save the settings first if you
   changed them. It can be run again safely.
4. Send a test from MySendbox's dashboard before the first real post.

## Consent

MySendbox keeps a record of how each contact agreed. A member is copied as
subscribed only when the CMS knows that:

| Member | Copied as |
|---|---|
| Signed up themselves (magic link, address confirmed) | Subscribed. The consent record says they signed up. |
| Turned newsletters back on themselves | Subscribed. The record says so, with the date. |
| Added by an admin, or imported, **with** a consent attestation set | Subscribed, with the attestation in your words. |
| Added or imported, no attestation, **with** a signup form set | Sent the form's double opt-in mail. Pending until they confirm. |
| Added or imported, neither | Not copied. The settings card and health page count them. |

**MySendbox decides unsubscribes.** Someone who unsubscribed there can only
come back through a MySendbox form. If they turn newsletters back on in the
CMS:
- with a signup form set, they're sent its confirmation mail;
- without one, the CMS follows MySendbox, and they stay unsubscribed.

Deleting a member in the CMS erases their contact in MySendbox.

## How it stays in step

- **By state, not by event.** A member change marks a row in
  `mysendbox_contacts` dirty. Syncing reads the member as they are now and
  makes MySendbox match, so a lost event costs a delay, never a difference.
  Dirty rows are synced:
  - in the background right after the change;
  - before every broadcast;
  - by the reconcile task (every six hours, or daily with a daily tick).
- **A MySendbox outage** leaves the row dirty, and it is retried. A refusal
  (4xx) is recorded and not retried until the member changes again.
- **A broadcast is made once per post.** The members feature claims the send
  first. This feature records the broadcast's id before scheduling it, so a
  retried hand-off reuses it instead of making a second one (MySendbox's
  broadcasts take no idempotency key). If the hand-off fails, the send waits
  as `handoff_failed` and is retried. The built-in queue never sends it
  instead.
- **Webhook events** are verified (`MySendbox-Signature`, five minutes'
  tolerance). Applying one twice changes nothing, and an older event
  delivered late cannot undo a newer one.
- **The daily check** lists the audience's unsubscribed, bounced, complained
  and cleaned contacts, for anything a missed webhook didn't bring.

The editor's newsletter panel shows MySendbox's counts for a handed-off post.
MySendbox leaves out subscribers with no opens, clicks or new consent in six
months, so a broadcast can reach fewer people than the active member count.
The settings card shows MySendbox's own count of who a broadcast would reach
now.

## Files

- **`client.ts`:** the MySendbox API calls. They return results and never
  throw.
- **`config.ts`:** environment variables, settings, and the audience.
- **`contacts.ts`:** member sync, backfill, and applying MySendbox's
  statuses.
- **`broadcasts.ts`:** the `newsletter.delivering` and `newsletter.status`
  listeners.
- **`webhook.ts`:** `POST /api/webhooks/mysendbox`. The body parser skips
  `/api/webhooks/` (see `basicben.config.js`), so the signature is checked
  over the raw body.
- **Tables:** `mysendbox_contacts` and `mysendbox_broadcasts` (migration 042).
  They are left out of the content export.
