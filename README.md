# BasicBen CMS

Posts, pages, categories, tags, media, comments, an admin UI, and a headless
content API at `/api/v1`. Built on [BasicBen](https://github.com/BasicBenFramework/core).

This repository *is* the CMS. Clone it, or scaffold a copy with
`npx @basicbenframework/create` — either way it is a plain BasicBen
application that installs the framework from npm, the same shape as any other.

Nothing here is published. Both `@basicbenframework/core` and
`@basicbenframework/create` are released from
[BasicBenFramework/core](https://github.com/BasicBenFramework/core); the
scaffolder downloads this repository at run time rather than bundling a copy of
it, so there is no snapshot to keep in step.

## Getting started

```bash
npm install
npm run migrate
npm run dev          # admin on http://localhost:3000, API on :3001
```

The first account you register becomes the admin; everyone after is a
subscriber, so register yours first. Without a `RESEND_API_KEY` mail is printed
to the terminal rather than sent, including the verification link.

Copy `.env.example` to `.env` and generate an `APP_KEY`. Everything else is
optional for local work.

## Commands

```bash
npm run dev              # Development
npm run build            # Production build
npm start                # Production server
npm test                 # Tests
npm run migrate          # Apply pending migrations
npm run migrate:status   # What has and has not run
npm run migrate:rollback # Undo the last batch
```

## Databases

SQLite by default, with no configuration. Postgres and Turso are selected from
the environment rather than named in config — a `postgres://` `DATABASE_URL`
picks Postgres, a `TURSO_URL` picks Turso.

Each migration runs in a transaction together with the row recording that it
ran, so a failure leaves the schema untouched rather than half-applied. Two
limits are documented rather than worked around, neither reachable from the
migrations shipped here: Postgres refuses `CREATE INDEX CONCURRENTLY` and
`VACUUM` inside a transaction, and SQLite ignores `PRAGMA foreign_keys` there.

## The headless API

`/api/v1/{posts,pages,categories,tags,media}`, read-only, authenticated with a
scoped `bb_` token or served anonymously if you turn on public reads. The
response shapes are documented at `/docs/headless` in the running app, and that
page is **generated** from the interfaces in `src/models/PublicContent.ts` — so
the field list cannot drift from the code. Re-run it after changing a shape:

```bash
node scripts/generate-api-reference.js
```

A test fails when the checked-in output stops matching.

### Rate limits shape how consumers should read

`/api/v1` allows 120 requests a minute per address, keyed on the address rather
than the token because the limiter has to run before authentication — otherwise
a flood of fabricated tokens is never limited.

That budget assumes consumers fetch *collections*. A static site generator that
fetches one post per slug makes one request per post and will cross the ceiling
somewhere past a hundred posts. Fetch pages of 100 and slice locally: a whole
site becomes a handful of requests.

## Migrating from WordPress

```bash
node --env-file=.env scripts/import-wordpress.mjs --dry-run
node --env-file=.env scripts/import-wordpress.mjs
```

Posts are matched on slug, so it is safe to run repeatedly — import now, keep
publishing on WordPress, re-run immediately before cutting over.

It does not re-upload media. A featured image is recorded as the object key it
already has and served through `publicUrl`, so images resolve when storage
points at the host already serving them. If your WordPress media sits on the
WordPress host rather than object storage, move the files first.

WordPress allows many categories per post and this schema allows one: the first
becomes the category and the rest become tags, which are many-to-many here and
so lose nothing.

## Deploying

`npm start` runs this on any persistent host with nothing to configure.

### Vercel

`vercel.json` and `api/index.js` are the whole of it. BasicBen is a long-running
`node:http` server and Vercel invokes a handler per request, so the handler
bridges them: `app.server` is a real `http.Server`, and that class dispatches by
emitting `request` — handing it Vercel's `req`/`res` runs the identical
middleware chain, router and error handler. Nothing is re-implemented, and local
and production execute the same code. `src/server/index.ts` skips its own
`listen()` when `VERCEL` is set.

Two things that catch people out:

- **`/feed.xml`, `/feed.json` and `/sitemap.xml` are server-rendered** and live
  outside `/api`. A rewrite covering only `/api/*` 404s all three, and the admin
  UI still looks fine, so it is easy to miss.
- **Object storage stops being optional.** The filesystem is read-only apart
  from an ephemeral `/tmp`, so the local driver cannot accept uploads at all.
  The app warns at boot when it detects that combination. Reads are unaffected.

Set `APP_KEY`, `APP_URL`, your database variables and the `S3_*` group in the
project's environment. Run migrations from your machine or CI — they do not run
on a serverless host.

The framework declares `engines.node >= 24`; confirm the platform offers it.

## Layout

```
src/
├── routes/api/v1.ts        the public content API
├── models/PublicContent.ts what /api/v1 returns, and the reference's source
├── controllers/            business logic
├── middleware/             scopes, caching, rate limits
└── client/                 admin UI and docs pages
db/migrations/              schema, applied in order
tests/                      hook coverage, API reference drift
scripts/                    the importer, the generator, the smoke test
api/index.js                serverless handler
create/                     the scaffolder — a separate package, published alone
```

The framework is [@basicbenframework/core](https://github.com/BasicBenFramework/core),
installed from npm. It used to live here; it has its own repository, and this
depends on it like any consumer does.
