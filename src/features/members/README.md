# Members, members-only posts and newsletters

Members are readers. They sign in with a magic link, can read members-only
posts, and can subscribe to posts by email. They are not `users`: a member has
no password, no role, and no way into the admin — a member session is signed
with its own key and every admin route refuses it.

## Signing in from a front end

Everything is JSON with bearer headers, so it works from any origin. No
cookies.

1. `POST /api/v1/members/magic-link` with `{ "email": "...", "name"?: "...", "newsletter"?: true }`.
   Always answers `200 { "message": ... }` for a well-formed address, whether
   or not it is a member — the endpoint never says which. Limited per address
   (5 / 15 min) and, silently, per mailbox (3 / 15 min).
2. The mail links to **your** sign-in page with `?token=...` — the
   `members_signin_url` setting, or `SITE_URL/members/verify` when unset. The
   link never points at the API, so a mail scanner opening it cannot spend
   the single-use token. A request can never choose where the link goes.
3. That page calls `POST /api/v1/members/verify` with `{ "token": "..." }`
   (`GET ?token=` also works) and receives `{ token, member }`. The token is a
   member session, valid for 30 days. Links expire after an hour and work once.

Then, with the session in `X-Member-Token: <token>` (the member endpoints also
accept `Authorization: Bearer <token>`):

| Route | |
|---|---|
| `GET /api/v1/members/me` | `{ member: { id, email, name, newsletter, email_verified, created_at } }` |
| `PUT /api/v1/members/me` | `{ name?, newsletter?: boolean }` |
| `POST /api/v1/members/signout` | Ends **every** session the member holds. |

Who may join is the `members_signup` setting: `open` (default — anyone),
`invite` (only addresses added or imported in the admin) or `closed` (no links
are sent; existing sessions run until they expire or sign out).

## Members-only posts

A post's `visibility` is `public`, `members` or `paid`. **`paid` is reserved for
paid subscriptions and is enforced exactly like `members` until those exist.**

On `/api/v1/posts` and `/api/v1/posts/:slug` a gated post is still listed —
title, excerpt, images, dates, SEO (an excerpt that would be the whole body is withheld too) — but `content` is `null` and `gated` is
`true` unless the request carries a valid member session in `X-Member-Token`.
That header is separate from `Authorization`, so a server-side front end can
send its own `content:read` token *and* forward the reader's session:

```
Authorization: Bearer bb_...        # the site's content:read token
X-Member-Token: eyJ...              # the reader's member session
```

Caching: any response to a request carrying `X-Member-Token` (valid or not) is
`Cache-Control: private`, and every response sends
`Vary: Authorization, X-Member-Token`, so a shared cache never serves a
member's response to an anonymous reader. If you cache at your own edge, key on
that header or skip caching when it is present.

RSS and JSON Feed list gated posts with their excerpt and a notice, never the
body. The excerpt is public on gated posts — if one is derived automatically it
comes from the start of the body, so write one by hand when that matters. When
the automatic excerpt would be the whole body (a short post), it is withheld
along with the body.

## Newsletters

In the editor, **Email to subscribed members when it goes live** (editors and
admins only) asks for the post to be mailed. It is sent once, to every member
whose newsletter is on, when the post goes live — at publish, or when a
schedule arrives. A post is never sent twice and a member never receives the
same post twice (enforced by unique constraints).

Sending is batched and resumable:

- a long-running server sends 100 a minute on its own;
- on serverless, call `GET /api/cron/newsletters` (`Authorization: Bearer $CRON_SECRET`,
  `?limit=` default 100, max 500) every minute or two — e.g. Vercel Cron;
- admin activity (the editor's newsletter panel, the Members page) also nudges
  the queue.

A provider error is retried up to 3 times. A mail interrupted mid-send (the
function was frozen) is marked failed rather than retried, since it may have
been delivered.

Each mail carries a signed one-click unsubscribe link and RFC 8058
`List-Unsubscribe` / `List-Unsubscribe-Post` headers. `GET` on the link shows a
confirmation button; `POST` unsubscribes, with no account needed.

Sender name, reply-to and footer are settings on the Members page.

### Sending through a provider

Another feature can take over sending, such as `mysendbox`. Members announces
what it does through hooks, and the provider listens; neither imports the
other. The names are in `events.ts`:

- `member.created`, `member.updated` (with `previous` and `origin`) and
  `member.deleted`, so a provider can keep its contact list in step. An update
  that changes nothing is not announced.
- `newsletter.delivering`, a strict filter run once per post before the queue
  is filled. A provider takes the send by returning it with `handledBy` and
  `externalId`; the send becomes `handed_off` and nothing is queued. If the
  provider throws, the send becomes `handoff_failed` and is retried every ten
  minutes the cron runs. It is never sent by the built-in queue instead, so
  an outage cannot become a second sender.
- `newsletter.status`, for the editor's panel to show the provider's counts.
- `newsletter.subscription`, which members listens to: a provider reporting
  that someone unsubscribed (or subscribed) on its side. The member follows.

The message a provider is given has no recipient and no site unsubscribe
link, since the provider adds its own.
