# Analytics

BasicBen counts page views and visitors without cookies, without storing IP
addresses or user agents, and without anything that could follow a person from
one day to the next. The admin's **Analytics** page shows views and visitors
over 7, 30 or 90 days, the top pages and the top referring sites.

The CMS is headless, so it cannot see page views itself — your front end
reports them with a one-line request. This page covers the snippet, the
endpoint, and exactly what is stored.

## Add it to your front end

Drop this into every page, before `</body>`. Replace the endpoint with your
CMS's address.

```html
<script>
(function () {
  var endpoint = 'https://cms.example.com/api/v1/analytics/hit'

  // Respect the visitor's choice before anything is sent. The server checks
  // the same headers, so this only saves the request.
  if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl) return

  var first = true
  function hit() {
    var body = JSON.stringify({
      path: location.pathname,
      // Only on the first page: after that the "referrer" is your own site.
      referrer: first ? document.referrer || undefined : undefined
    })
    first = false
    // A string body is sent as text/plain, which needs no CORS preflight.
    if (navigator.sendBeacon && navigator.sendBeacon(endpoint, body)) return
    fetch(endpoint, { method: 'POST', body: body, keepalive: true, mode: 'cors' })
  }

  hit()

  // Single-page apps change pages without a load. Count those too.
  var push = history.pushState
  history.pushState = function () { push.apply(this, arguments); hit() }
  addEventListener('popstate', hit)
})()
</script>
```

If your site sends a Content-Security-Policy, add the CMS origin to
`connect-src`.

Send hits **from the browser**, not from your server. Unique visitors are
derived from the address the request comes from; a server-rendered front end
calling the endpoint itself would make every reader look like one visitor
(your server).

## The endpoint

`POST /api/v1/analytics/hit`

```json
{ "path": "/blog/hello-world", "referrer": "https://news.ycombinator.com/item?id=1" }
```

- No credential. Any origin may call it (the CMS's CORS policy is `*`).
- `path` is required: a path starting with `/`, or a full http(s) URL, which
  is reduced to its path. The query string and fragment are always dropped —
  they are where tracking parameters, search terms and reset tokens live.
  Doubled and trailing slashes are collapsed, so `/a/` and `/a` are one page.
- `referrer` is optional. Only its domain is kept (`news.ycombinator.com`),
  with `www.` removed. Links from your own site (SITE_URL, APP_URL or the
  request's Origin) are not referrers.
- The body may be JSON (`application/json`) or a JSON string sent as
  `text/plain`, which is what `navigator.sendBeacon` sends.
- Answers `204 No Content` whether or not the hit was counted, and
  `400` only when `path` is missing or unusable.
- Not counted: requests with `DNT: 1` or `Sec-GPC: 1`, an empty user agent,
  and user agents that look like crawlers, link previewers, monitors or HTTP
  libraries.
- Rate-limited to 120 hits a minute per address (keyed on a hash of the
  address, so the limiter does not store it either).
- At most 5,000 distinct paths and 1,000 referring domains are tracked per
  day; past that, new ones are counted as `(other)`. The endpoint is public,
  and without a cap anyone could grow the tables by inventing paths.

## The privacy model

**What is kept:** per UTC day, the number of views and of unique visitors for
the whole site and for each path, and the number of views from each referring
domain. These are counts. There is no table of individual hits, so there is
nothing that could be joined back into one person's visit.

**What is never stored:** IP addresses, user agents, cookies, full referrer
URLs, query strings, screen sizes, locations.

**How unique visitors are counted.** On a reader's first hit of a UTC day, the
server takes their address (IPv6 shortened to its /64, as the rate limiter
does), their user agent, and a **random salt created for that day**, and
hashes them. Seeing that hash again the same day means "already counted". A
second hash also mixes in the path, for per-page visitors — stored as a
separate, unrelated row, so even while the hashes exist they cannot be grouped
into a list of pages one person read. APP_KEY is mixed into every hash too.

**Why a stored random salt, deleted daily, rather than one derived from
APP_KEY + date.** The IPv4 address space is small enough to brute-force: with a
salt you can recompute, any surviving hash can be matched back to an address.
A derived salt can always be recomputed by whoever has APP_KEY. A random salt
that is deleted when its day ends cannot, so once it is gone yesterday's hashes
are just noise — and they are deleted at the same time anyway. The salt is
kept in the database (not in memory) so every serverless instance hashes with
the same one.

**Why a table of hashes rather than a HyperLogLog or an in-memory Set.** A Set
works on one long-running process and silently overcounts on serverless, where
each request may land on a different instance. A HyperLogLog would need the
same shared storage and gives approximate counts that are hard to explain. One
short-lived row per visitor per day is exact, works on every host, and is
simple to audit: it is deleted on a schedule you can see on the health page.

**Retention.**

| Data | Kept for | Setting |
| --- | --- | --- |
| Visitor hashes (`analytics_seen`) | until the UTC day ends, or the dedup window (default 24 h) if shorter | `analytics_dedup_hours` (1–24) |
| Daily salt (`analytics_salts`) | until the UTC day ends | — |
| Daily counts | forever by default | `analytics_retention_days` (0 = forever) |
| Rate-limiter entry (hashed address) | the limiter window, swept by the maintenance cron | — |

A shorter dedup window means a reader who comes back later the same day is
counted as a new visitor; that is the trade for holding even pseudonymous data
for less time.

The purge runs on incoming hits and when an admin opens the Analytics page (at
most every ten minutes per instance), and on `GET /api/cron/maintenance`.
**Schedule that cron** so a site with no traffic on a given day still forgets
on time — the Site health page warns when hashes outlive their window.

**What the numbers mean.** "Visitors" over a range is the sum of each day's
unique visitors: someone who reads on three days counts three times. Uniques
across days would need exactly the long-lived identifier this design refuses
to keep. Days are UTC.

The per-day hashes and salts are never included in exports or backups; the
daily counts are left out of the JSON export too (they stay with the database,
and are in a `--sqlite-copy` backup).

## Settings

On the Analytics page (admins), or `PUT /api/settings`:

- `analytics_enabled` — `true`/`false`. Unset means on; turning it off makes
  the endpoint accept and discard every hit.
- `analytics_dedup_hours` — 1 to 24, default 24.
- `analytics_retention_days` — 0 to 3650, default 0 (keep).

## Reading the numbers from code

`GET /api/admin/analytics?days=7|30|90` (a signed-in editor or admin) returns
`{ data: { totals, series, top_paths, top_referrers, from, to }, settings }`.
