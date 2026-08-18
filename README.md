# BasicBen

> Ship faster with less. A full-stack framework for React. Zero runtime dependencies.

BasicBen gives you a productive, convention-driven structure for building React apps with a Node.js backend — without pulling in a bloated framework or locking you into vendor ecosystems.

---

## Why BasicBen?

Most JS frameworks make one of two mistakes: they do too much (Next.js, Remix) or they do nothing and leave you to wire everything yourself. BasicBen sits in the middle — conventions when you want them, escape hatches when you don't.

| Framework | Trade-off |
|-----------|-----------|
| Next.js / Remix | Too much magic, vendor lock-in |
| Express + Vite | Wire everything yourself |
| **BasicBen** | ✅ Conventions + control |

### Core Principles

- **Zero runtime dependencies** — HTTP server, router, JWT auth, validation — all written from scratch using Node.js built-ins
- **Laravel-inspired DX** — migrations, controllers, models, and scaffolding commands that feel familiar
- **No lock-in** — just React, Node.js, and Vite. Eject anytime — your code is still your code
- **Escape hatches** — every convention can be overridden via `basicben.config.js`

---

## Requirements

- Node.js 24+ (current LTS)

---

## Quick Start

```bash
npx @basicbenframework/create my-app
cd my-app
npm install
npx basicben migrate
npx basicben dev
```

Your app is running at `http://localhost:3000` — a working CMS, not a starter
skeleton: authentication with two-factor and passkeys, posts and pages,
categories, tags, comments, a media library, a headless content API, and an
admin panel to manage them.

Apps are TypeScript. Nothing forces you to annotate anything — Vite compiles
the app either way — but the types are there when you want them, and the admin
panel is written against them.

### Local Development

To develop against a local copy of the framework:

```bash
npx @basicbenframework/create my-app --local
```

This sets the `basicben` dependency to `file:../core` instead of fetching from npm.

---

## Project Structure

A new BasicBen project looks like this:

```
my-app/
├── index.html               # Vite entry point
├── src/
│   ├── main.tsx             # React entry point
│   ├── routes/
│   │   ├── App.tsx          # Client routes
│   │   └── api/             # Auto-loaded API routes
│   ├── controllers/         # Business logic
│   ├── models/              # DB query wrappers
│   ├── middleware/          # Route middleware
│   ├── helpers/             # Utility functions
│   ├── types/               # Shared type definitions
│   ├── server/              # Server entry point
│   └── client/              # React frontend
│       ├── layouts/         # Layout components
│       ├── pages/           # Page components, including admin/
│       └── components/      # Reusable UI components
├── db/
│   ├── migrations/          # Database migrations
│   └── seeds/               # Database seeders
├── mail/                    # Email templates
├── public/                  # Static assets
├── tsconfig.json
├── vite.config.ts
└── basicben.config.js
```

Routes, middleware, and models are loaded automatically — no manual imports needed.

---

## Starter Features

Every new BasicBen project includes a fully functional blog app:

### Authentication
- User registration and login with JWT
- Protected routes with auth middleware
- Password hashing with `node:crypto`

### User Profile
- View and edit profile (name, email)
- Change password

### Blog Posts
- Create, edit, delete posts
- Publish/draft toggle
- List your own posts

### Public Feed
- View all published posts
- Single post view with author info

### React Components
The frontend uses reusable components:
- `Button`, `Input`, `Textarea`, `Card` — form elements
- `Alert`, `Loading`, `Empty` — feedback states
- `PageHeader`, `BackLink`, `Avatar` — layout helpers
- `ThemeContext` — light/dark mode support

---

## Blogging Platform

BasicBen includes WordPress-like blogging features out of the box:

### Content Management
- **Posts** — Create, edit, publish with drafts and scheduling
- **Markdown** — Written in Markdown, rendered and sanitized on save
- **Pages** — Static pages with hierarchy support
- **Categories** — Hierarchical post organization
- **Tags** — Flat tagging system
- **Comments** — Threaded comments with moderation
- **Media Library** — Upload and manage images/files

### SEO & Feeds
- Meta titles and descriptions per post/page
- Auto-generated slugs
- RSS feed (`/feed.xml`)
- JSON feed (`/feed.json`)
- Sitemap (`/sitemap.xml`)

### Admin Dashboard
Navigate to `/admin` to access:
- Dashboard with stats and quick actions
- Post and page management
- Category and tag management
- Comment moderation
- Media library
- API tokens for the headless content API
- Site settings

---

## Extending

Hooks are how you change what the framework does without forking it. They live
in `src/hooks.ts`, imported once by the server entry, so every listener is
registered before the first request.

```js
import { hooks, HOOKS } from '@basicbenframework/core/hooks'

// A filter — return the value, changed. Return { cancel: true, reason }
// to refuse the write entirely.
hooks.on(HOOKS.POST_CREATING, async (data) => ({
  ...data,
  title: data.title.trim()
}))

// A notification — the return value is ignored.
hooks.on(HOOKS.MEDIA_UPLOADED, async ({ url }) => {
  await purgeCdn(url)
}, { name: 'cdn-purge' })
```

The filter/notification distinction is the thing to get right: a filter that
returns nothing replaces the value with undefined.

All 36, by family: `server.*`, `request.*`, `post.*`, `page.*`, `comment.*`,
`content.render/save/delete`, `media.*`, `auth.*`, `email.*`, `mail.*`,
`admin.*`. Every hook the framework declares fires — checked by a test that
walks the constants and looks for a call site.

A listener that throws is contained and the others still run. Pass a `name` so
the logged error points at the culprit rather than only naming the hook.
`priority` takes a number, lower first, default 10. Set
`BASICBEN_DEBUG_HOOKS=1` for stack traces.

**Where hooks fire matters.** The registry is a singleton per JavaScript realm,
and the browser is a different realm from the server. `src/hooks.ts` is imported
by the server entry, so a hook fired in the browser would consult an empty
registry — which is why `admin.menu` fires on the server and reaches the UI
through an API.

### There is no plugin system

There was one. It wrapped exactly the calls above in an object with a name, a
version and an activation switch, and it was removed in 0.5.0.

A plugin could not be installed at runtime on any host that rebuilds from an
image, so the container bought nothing that `import` does not already do.
Shipping an extension as an npm package still works: install it, import it, call
`hooks.on`.

---

## CLI

```bash
# Development
basicben dev                       # Start Vite + Node dev server
basicben build                     # Bundle client + server for production
basicben build --static            # Build client only (for static hosts)
basicben start                     # Run production server
basicben test                      # Run tests with Vitest

# Scaffolding
basicben make:controller <name>    # Generate a controller
basicben make:route <name>         # Generate a route file
basicben make:model <name>         # Generate a model
basicben make:migration <name>     # Generate a migration file
basicben make:middleware <name>    # Generate middleware (auth template if name is 'auth')

# Database
basicben migrate                   # Run all pending migrations
basicben migrate:rollback          # Roll back the last batch
basicben migrate:fresh             # Drop everything and re-run all
basicben migrate:status            # Show which migrations have run

# Content
basicben content:rerender          # Rebuild stored HTML from the Markdown source
basicben content:rerender posts    # Just one table
basicben content:rerender --dry-run

# Help
basicben help                      # Show all commands
basicben help <command>            # Show help for a specific command
```

---

## Routing

### API Routes

Create a file in `src/routes/api/` and export a default function that receives the router:

```js
// src/routes/api/users.js
import { UserController } from '../../controllers/UserController.js'

export default (router) => {
  router.get('/api/users', UserController.index)
  router.get('/api/users/:id', UserController.show)
  router.post('/api/users', UserController.create)
  router.put('/api/users/:id', UserController.update)
  router.delete('/api/users/:id', UserController.destroy)
}
```

All files in `src/routes/api/` are registered automatically on startup.

### Client Routes

Client-side routing is configured in `src/routes/App.jsx`:

```js
// src/routes/App.jsx
import { createClientApp } from '@basicbenframework/core/client'
import { AppLayout } from '../client/layouts/AppLayout'
import { Home } from '../client/pages/Home'
import { Posts } from '../client/pages/Posts'

export default createClientApp({
  layout: AppLayout,
  routes: {
    '/': Home,
    '/posts': { component: Posts, auth: true },
  }
})
```

Route values are either a component or `{ component, auth, guest, layout }`.
`auth: true` redirects to `/login` when signed out; `guest: true` redirects to `/`
when signed in; `layout` overrides the default for that route.

Two optional components round out the app shell:

```js
export default createClientApp({
  layout: AppLayout,
  Loading,    // shown while the initial auth check is in flight
  NotFound,   // shown when no route matches, wrapped in the default layout
  routes: { /* ... */ }
})
```

Without `NotFound` an unmatched path renders a bare `404 - Not Found` string with
no navigation, so it is worth supplying one. Pair it with `static: { spa: true }`
on the server, which is what lets a deep link reach the client router at all.

---

## Controllers

Generate one with:

```bash
basicben make:controller UserController
```

```js
// src/controllers/UserController.js
import { User } from '../models/User.js'


export const UserController = {
  index: async (req, res) => {
    const users = await User.all()
    res.json(users)
  },

  show: async (req, res) => {
    const user = await User.find(req.params.id)
    if (!user) return res.status(404).json({ error: 'Not found' })
    res.json(user)
  },

  create: async (req, res) => {
    const user = await User.create(req.body)
    res.status(201).json(user)
  },

  update: async (req, res) => {
    const user = await User.update(req.params.id, req.body)
    res.json(user)
  },

  destroy: async (req, res) => {
    await User.destroy(req.params.id)
    res.status(204).send()
  }
}
```

---

## Databases

Three drivers: `sqlite` (the default), `postgres`, and `turso`.

| Driver | Use it for |
|---|---|
| `sqlite` | Local development, and single-node deployments with a persistent disk |
| `turso` | Hosted libSQL — SQLite semantics with no local disk, so it survives ephemeral hosts |
| `postgres` | PostgreSQL, and Neon, which is wire-compatible |

You usually do not have to name the driver. A connection string already says
which database it points at, so it is inferred from the URL:

```env
DATABASE_URL=./database.sqlite                       # sqlite
DATABASE_URL=postgres://user:pass@localhost/mydb     # postgres
TURSO_URL=libsql://your-db.turso.io                  # turso
TURSO_AUTH_TOKEN=your-token
```

An explicit `db.driver` in `basicben.config.js` always wins.

### Writing portable migrations

The migrator hands every `up` and `down` a grammar for the connected driver.
Use it for anything the two databases spell differently — a literal
`INTEGER PRIMARY KEY AUTOINCREMENT` is a SQLite-only migration, and Postgres
rejects it rather than adapting.

```js
export const up = async (db, grammar) => {
  await db.exec(`
    CREATE TABLE widgets (
      id ${grammar.autoIncrementPrimaryKey()},
      created_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

export const down = async (db, grammar) => {
  await db.exec(grammar.dropTable('widgets'))
}
```

`dropTable` matters on rollback: Postgres refuses to drop a table another table
references unless told to `CASCADE`, and SQLite has no such clause. Generated
migrations already use all three.

Placeholders need no thought — write `?` and the Postgres adapter rewrites them
to `$1, $2, …`, leaving string literals and jsonb operators alone.

Every shipped migration and the whole test suite are exercised against real
Postgres, not just SQLite:

```bash
SMOKE_DATABASE_URL=postgres://user@localhost:5432/smoke ./scripts/smoke-test.sh
```

### Turso

Turso speaks libSQL, which is SQLite — so the SQL, the migrations and the query
builder are the same as the local file driver. There is nothing to port.

```env
TURSO_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your-token
```

The adapter talks Hrana 3 over HTTP with `fetch` and needs no client library, so
it adds no dependency. `libsql://`, `https://`, `wss://` and `ws://` URLs are all
accepted; the last two are useful when pointing at a local `sqld`.

Transactions work as they do everywhere else, and the callback receives a
transaction-scoped connection:

```js
await db.transaction(async (tx) => {
  await tx.run('INSERT INTO posts (title) VALUES (?)', ['Hello'])
  await tx.run('UPDATE counters SET posts = posts + 1')
})
```

Two things worth knowing. Because HTTP is stateless, libSQL ties a transaction
together with a token passed on each request, which means statements inside one
are serialized — a transaction is not the place for concurrent work. And an
integer larger than `Number.MAX_SAFE_INTEGER` comes back as a `BigInt` rather
than a rounded number, since silently losing precision on a rowid would be worse
than returning a type you have to notice.

### PlanetScale

Not supported. It is MySQL, and there is no MySQL driver or grammar. Earlier
versions of the example configuration listed it; that was wrong.

---

## Models

Generate one with:

```bash
basicben make:model User
```

Models are thin wrappers around raw DB queries — no ORM, no magic.

```js
// src/models/User.js
import { db } from '@basicbenframework/core/db'

export const User = {
  all: () => db.all(`SELECT * FROM users`),
  find: (id) => db.get(`SELECT * FROM users WHERE id = ?`, id),
  create: (data) => db.run(`INSERT INTO users (name, email) VALUES (?, ?)`, [data.name, data.email]),
  update: (id, data) => db.run(`UPDATE users SET name = ?, email = ? WHERE id = ?`, [data.name, data.email, id]),
  destroy: (id) => db.run(`DELETE FROM users WHERE id = ?`, id)
}
```

---

## Migrations

Generate a migration with:

```bash
basicben make:migration create_users
```

This creates a timestamped file in `db/migrations/`:

```js
// db/migrations/001_create_users.js
export const up = (db) => {
  db.run(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

export const down = (db) => {
  db.run(`DROP TABLE users`)
}
```

Then run:

```bash
basicben migrate
```

BasicBen tracks which migrations have run in a `_migrations` table. Running `migrate` again is always safe.

### Rolling back

```bash
basicben migrate:rollback    # Undo the last batch
basicben migrate:fresh       # Drop everything and start over
basicben migrate:status      # See what's run and what hasn't
```

---

## Middleware

Create a file in `src/middleware/` and export a default function. Middleware is loaded automatically before routes, in filename order.

```js
// src/middleware/auth.js
export default (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.status(401).json({ error: 'Unauthorized' })
  // verify token...
  next()
}
```

---

## Validation

BasicBen includes a lightweight validation system with 20+ built-in rules:

```js
import { validate, rules } from '@basicbenframework/core/validation'

const result = await validate(req.body, {
  email: [rules.required, rules.email],
  password: [rules.required, rules.min(8)],
  age: [rules.optional, rules.integer, rules.between(18, 120)]
})

if (result.fails()) {
  return res.status(422).json({ errors: result.errors })
}

// result.data contains validated data
```

### Built-in Rules

`required`, `optional`, `string`, `numeric`, `integer`, `boolean`, `array`, `email`, `url`, `min`, `max`, `between`, `in`, `notIn`, `regex`, `confirmed`, `different`, `length`, `alpha`, `alphanumeric`, `date`, `before`, `after`

### Database Rules

Two async rules query the database directly — useful for unique fields and foreign keys:

```js
await validate(req.body, {
  // Email must not already exist in users table
  email: [rules.required, rules.email, rules.unique('users')],

  // On update, exclude the current user's row
  // email: [rules.required, rules.email, rules.unique('users', 'email', userId)],

  // Referenced category must exist
  category_id: [rules.required, rules.exists('categories')]
})
```

### Custom Rules

```js
const uniqueEmail = async (value) => {
  const exists = await db.get('SELECT 1 FROM users WHERE email = ?', value)
  return exists ? 'Email already exists' : null
}

await validate(req.body, {
  email: [rules.required, rules.email, uniqueEmail]
})
```

---

## Authentication

BasicBen provides JWT helpers using Node's built-in `crypto` module — no `jsonwebtoken` dependency:

```js
import { signJwt, verifyJwt } from '@basicbenframework/core/auth'

// Sign a token
const token = signJwt({ userId: 1 }, process.env.APP_KEY, { expiresIn: '7d' })

// Verify a token
const payload = verifyJwt(token, process.env.APP_KEY)
if (!payload) {
  // Invalid or expired
}
```

The starter template includes a complete auth system:

```js
// src/middleware/auth.js
import { verifyJwt } from '@basicbenframework/core/auth'

export const auth = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const payload = verifyJwt(token, process.env.APP_KEY)
  if (!payload) return res.status(401).json({ error: 'Invalid token' })

  req.userId = payload.userId
  next()
}
```

Use it in your routes:

```js
// src/routes/api/posts.js
import { auth } from '../../middleware/auth.js'
import { PostController } from '../../controllers/PostController.js'

export default (router) => {
  router.get('/api/posts', auth, PostController.index)
  router.post('/api/posts', auth, PostController.store)
}
```

---

## Mail

A transport is any async function taking a message, so adapting a client this
framework does not ship is a few lines. Four are built in.

| Transport | Use it for |
|---|---|
| `console` | The default. Logs the message instead of sending, so a new project works with no mail account |
| `smtp` | Any SMTP provider, or Mailpit locally |
| `resend` | Resend, via its SMTP relay |
| `http` | Providers with a JSON API — Postmark, Mailgun, SES |

```js
// basicben.config.js
mail: {
  from: process.env.MAIL_FROM || 'BasicBen <onboarding@resend.dev>',
  transport: process.env.RESEND_API_KEY ? 'resend' : 'console',
  apiKey: process.env.RESEND_API_KEY
}
```

The console transport prints the body, which is what makes a verification link
usable before any provider is configured — it appears in the terminal running
the dev server.

### SMTP

```js
mail: {
  from: 'App <noreply@example.com>',
  transport: 'smtp',
  host: process.env.SMTP_HOST,
  port: 587,
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS
}
```

Port 465 is implicit TLS; 587 connects in the clear and upgrades with STARTTLS.
**Credentials are never sent before the session is encrypted** — if a server
offers no STARTTLS on a submission port, the client refuses rather than leaking
the password. Set `requireTls: false` only for a local relay that has no
password either.

For Resend, `transport: 'resend'` is the same SMTP client pointed at
`smtp.resend.com` with the API key as the password.

### Testing locally

[Mailpit](https://mailpit.axllent.org) is an SMTP server with a web inbox, which
means you can exercise the real path without sending anything:

```bash
docker run -d -p 1025:1025 -p 8025:8025 axllent/mailpit
```

```js
mail: { transport: 'smtp', host: 'localhost', port: 1025 }
```

Messages appear at `http://localhost:8025`.

### Templates

`renderMail(name, data)` reads `mail/<name>.txt` and `mail/<name>.html` and
substitutes `{{placeholders}}`. Values are HTML-escaped in the HTML part and
left alone in the text part, so a URL with a query string survives intact. Use
`{{{key}}}` for markup you trust.

```js
import { sendMail, renderMail } from '@basicbenframework/core/mail'

await sendMail({
  to: user.email,
  subject: 'Confirm your email address',
  ...renderMail('verify-email', { name: user.name, verifyUrl })
})
```

---

## Email Verification

New accounts must confirm their address. **The first account to register is
verified automatically** — it is the operator setting the site up, and on a
fresh install mail is very likely unconfigured, so requiring a link that was
never delivered would lock them out of their own admin.

An unverified user can sign in but holds no capabilities beyond their own
profile and requesting another email. That is deliberately not "no access at
all": letting the request through means the interface can explain the problem
instead of showing a bare error.

```
POST /api/auth/register        # creates the account and sends the link
GET  /api/auth/verify/:token   # the emailed link; redeems and redirects
GET  /api/auth/verify          # whether the signed-in user still needs to
POST /api/auth/verify/resend   # another email, once per five minutes
```

A send failure does not fail the registration — the account exists either way,
and a 500 would leave the caller believing it does not. The response carries
`verificationSent` so the client can offer a resend.

Tokens are 32 random bytes, stored only as a SHA-256 hash, valid for 24 hours
and redeemable once. Redemption is a single conditional `UPDATE`, so two
concurrent requests cannot both succeed. Changing an email address revokes any
outstanding link and clears the flag, so it always describes the current
address.

---

## Object Storage (R2, S3, and friends)

Media lives in object storage. Uploads go **straight from the browser to the
bucket** — this server signs a URL and records a row; the file bytes never pass
through Node.

```js
import { getStorage } from '@basicbenframework/core/storage'

const storage = await getStorage()

await storage.put('media/a.png', bytes, { contentType: 'image/png' })
await storage.get('media/a.png')          // → { body, contentType, size, etag }
await storage.head('media/a.png')         // → metadata, or null
await storage.delete('media/a.png')
await storage.list({ prefix: 'media/' })  // → { items, cursor }

storage.signedUrl('media/a.png', { method: 'PUT', expiresIn: 900 })
storage.publicUrl('media/a.png')
```

### One driver, not two

R2 speaks the S3 API, and so do MinIO, Backblaze B2 and DigitalOcean Spaces. The
difference between them is an endpoint and a region, so there is one driver and
no branching in application code. Moving from R2 to S3 is two lines of config.

```js
// basicben.config.js — Cloudflare R2
storage: {
  driver: 's3',
  endpoint: 'https://<account-id>.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: process.env.S3_BUCKET,
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  publicUrl: 'https://cdn.example.com'   // optional CDN or custom domain
}

// AWS S3 — omit the endpoint, name a real region
storage: { driver: 's3', region: 'us-east-1', bucket: '…', /* keys */ }
```

Configure nothing and the `local` driver writes to `public/uploads`, so a new
project works before anyone has a cloud account.

### No AWS SDK

`@aws-sdk/client-s3` is tens of megabytes for what is, underneath, one HMAC
chain. SigV4 is HMAC-SHA256 and SHA-256, both already in `node:crypto`, so the
signer is written here and `dependencies` stays empty.

A hand-rolled signer is only worth trusting if it is checked against something
outside itself, so it is checked two ways: **AWS's own 34 published test
vectors**, stage by stage, and **a real MinIO server**, which is the only thing
that proves an actual S3 implementation accepts what it produces.

### How an upload works

```
Browser                    BasicBen                  R2 / S3
   │  POST /api/media/sign    │                         │
   │─────────────────────────>│  (validate, then sign)  │
   │  { uploadUrl, key,       │                         │
   │    ticket, headers }     │                         │
   │<─────────────────────────│                         │
   │  PUT <uploadUrl>  ────── file bytes ──────────────> │
   │  POST /api/media/confirm │                         │
   │─────────────────────────>│  HEAD, then INSERT      │
```

The content type and size are validated **before** anything is signed, because a
caller without a signed URL cannot upload at all — that is the enforcement point,
not a courtesy check. HTML, SVG and JavaScript are refused outright: a bucket
served from a domain hands those back with the type they were stored under,
which is same-origin script execution.

Two things a presigned URL does not do, and what is done about each:

**It does not cap the size.** A URL issued for a thumbnail will accept a
gigabyte. `confirm` therefore HEADs the stored object and deletes it if it came
back larger than allowed. The declared size is checked too, but only the stored
size is believed.

**It does not say who uploaded what.** The key travels through the browser, so
each signed upload carries a **ticket** — an HMAC over the key, the owner and the
expiry — checked at confirm time. Without it, a caller could confirm someone
else's object as its own media row. It is stateless, so there is no pending-upload
table to clean up.

### Hooks

`media.uploading` runs before signing and can rewrite the key or refuse the
upload; `media.uploaded` and `media.deleted` fire after the fact.

```js
hooks.on('media.uploading', (upload) => ({ ...upload, key: `tenant-7/${upload.key}` }))
hooks.on('media.uploading', (upload) => ({ ...upload, cancel: true, reason: 'Quota exceeded.' }))
```

---

## Content & Markdown

Posts and pages are written in Markdown. Every table storing content keeps two
columns: `content` holds the Markdown and is canonical, and `content_html` holds
the rendered, sanitized result.

```js
import { renderContent, excerpt, slugify } from '@basicbenframework/core/content'

const html = await renderContent('# Title\n\nSome **bold** text.')
const summary = excerpt(markdown, 200)   // plain text, cut at a word boundary
const url = slugify('Hello, World!')      // "hello-world"
```

Rendering happens **on save**, not per request — a blog is read far more often
than it is written. Models do it for you; `Post.create` and `Post.update` render
whenever `content` changes, so the two columns cannot drift apart.

Never render `content` as HTML. It is Markdown, and `content_html` is the column
that has been through the sanitizer.

### Why there is no Markdown dependency

The framework has no runtime dependencies, and this is the place that argument
usually breaks down: hand-writing a parser sounds like an XSS risk. It is the
reverse. CommonMark *requires* raw HTML to pass through verbatim — 64 of the
spec's 652 cases exist to pin that down — which is exactly why every
off-the-shelf parser tells you to sanitize its output.

This parser refuses those 64 cases on purpose. It escapes everything it reads
and emits only tags from its own vocabulary, so no input can become a tag.
`sanitizeHtml` still runs afterwards, as a second layer rather than the only one.

It is measured against the real CommonMark suite on every test run, and the
number is reported rather than claimed: **93% of the spec excluding the raw-HTML
sections**, which are the ones it will never pass by design.

### What is supported

Headings (ATX and setext), emphasis, strong, strikethrough, inline code, fenced
and indented code blocks, blockquotes, nested and tight/loose lists, links,
reference links, images, autolinks, tables, hard line breaks, backslash escapes,
and HTML entities. Headings get `id` anchors automatically.

### Sanitizing other HTML

The parser is safe on its own, but imported content — a WordPress export, a
a hook's output, a field you opened up to raw HTML — is not.

```js
import { sanitizeHtml } from '@basicbenframework/core/content'

sanitizeHtml(imported)                              // allowlist, drops the rest
sanitizeHtml(imported, { schemes: ['https'] })      // narrow the URL schemes
sanitizeHtml(imported, { allowed: { p: [], a: ['href'] } })
```

It is an allowlist: anything not named is removed. `script`, `style`, `iframe`,
`svg` and `math` are removed along with their contents; other unknown tags are
unwrapped so their text survives. Event handlers and `style` attributes never
pass. URLs are checked after entity decoding, so `&#x6A;avascript:` is caught.

### Extending the pipeline

A listener can post-process rendered HTML through the `content.render` filter —
syntax highlighting, lazy-loaded images, a table of contents:

```js
hooks.on('content.render', (html, { table, id }) =>
  html.replace(/<code>/g, '<code class="hljs">')
)
```

The filter runs **before** sanitization, never after. Sanitizing last and
unconditionally means no listener can put markup on the page the allowlist has not
seen.

The practical consequence, and the first thing you will hit writing a listener:
**your markup is subject to the allowlist too.** `<span class>`, `<code class>`
and `<img loading>` pass because they are on it; `<p class>` does not, and the
attribute will simply be gone. Widen the list rather than moving the filter:

```js
await renderContent(markdown, {
  allowed: { ...DEFAULT_ALLOWED, p: ['class'] }
})
```

### Rerendering

Stored HTML goes stale when the parser changes, the allowlist changes, or a
listener on `content.render` is added or removed:

```bash
basicben content:rerender
```

It only ever writes `content_html`, so it is safe to run repeatedly.

---

## Rate Limiting

```js
import { rateLimit } from '@basicbenframework/core/rate-limit'

router.post('/api/auth/login', rateLimit({ limit: 10, window: '15m' }), AuthController.login)
```

Refused requests get a 429 with `Retry-After`, and every response carries
`RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`.

### Sliding window

The window slides rather than resetting on a boundary. A fixed window lets a
caller spend the whole allowance at the end of one window and again at the
start of the next, so "5 per minute" would permit 10 in two seconds.

### Throttle or lock out

Add `blockFor` and exceeding the limit refuses for that long regardless of the
window — a throttle becomes a lockout:

```js
rateLimit({ limit: 5, window: '15m', blockFor: '15m' })
```

When the lockout lapses the count starts fresh, so the next single attempt does
not immediately re-lock.

### Where state lives

`MemoryStore` is the default: fast, per-process, and **the wrong choice for a
security control** — a restart clears it and a second instance cannot see it.
Use `DatabaseStore` when the limit is protecting something:

```js
import { rateLimit, DatabaseStore } from '@basicbenframework/core/rate-limit'
import { getDb } from '@basicbenframework/core/db'

const store = new DatabaseStore({ getDb })   // needs the rate_limits table
```

### Identifying the caller

By default the socket address. **`X-Forwarded-For` is ignored unless you set
`trustProxy`**, and that default is deliberate: the header is client-supplied,
so honouring it on a directly-exposed server lets anyone rotate their apparent
address and bypass every limit. Behind a proxy that overwrites it, set
`trustProxy: true`.

Pass `key` to group differently — by account rather than by address, for
instance:

```js
rateLimit({ limit: 5, window: '15m', key: (req) => `email:${req.body?.email}` })
```

The scaffolded app applies **both** to login, because they stop different
attacks: by address catches one attacker working through many accounts, by
account catches many addresses working on one, which is what credential
stuffing looks like. A successful sign-in clears the counter, so someone who
mistyped their password twice is not left part-way to a lockout.

### Consuming directly

Where the subject is only known after some work — the user behind a session,
say — use the limiter rather than the middleware:

```js
import { createLimiter } from '@basicbenframework/core/rate-limit'

const limiter = createLimiter({ limit: 3, window: '15m', store })

const allowance = await limiter.consume(`verify-email:${user.id}`)
if (!allowance.allowed) {
  return res.json({ error: 'Try again shortly.', retryAfter: allowance.retryAfter }, 429)
}
```

`peek()` reports the state without counting, and `reset(key)` clears it.

---

## Two-Factor Authentication

An authenticator app (TOTP) as a second factor, with recovery codes for when the
phone is gone. Zero dependencies — `node:crypto` has everything RFC 6238 needs.

The endpoints ship in the TypeScript template. The primitives are exported, so
any app can wire its own.

### How a login changes

With a factor enrolled, a correct password is no longer a session:

```
POST /api/auth/login
  ├─ no factor enrolled  → { user, token }                    (unchanged)
  └─ factor enrolled     → { twoFactorRequired: true, challenge, methods }

POST /api/auth/2fa/verify   { challenge, code }
  → { user, token }
```

The challenge is **not** a token. It is a single-use row in `auth_tokens` with a
five-minute life, never a JWT — so `verifyJwt` cannot return one and it cannot
be mistaken for a session, which would bypass the second factor entirely.

### Enrolling

```
POST   /api/auth/2fa/totp/setup     # password required; returns secret + otpauth URI
POST   /api/auth/2fa/totp/confirm   # a working code enables it, returns recovery codes
DELETE /api/auth/2fa/totp           # password required
GET    /api/auth/2fa                # what is enrolled
POST   /api/auth/2fa/recovery/rotate
```

Setup generates a secret but **enables nothing**. Enrolment completes only when
a working code proves the authenticator was actually configured — enabling on
generation is how people lock themselves out.

Adding or removing a factor requires the current password even though the caller
is signed in. Without that, a stolen session becomes permanent account takeover:
the attacker enrols their own factor and locks the owner out.

The setup response returns the `otpauth://` URI rather than a QR image. Encoding
one is several hundred lines for something the client renders in a few, and it
keeps the secret out of anything the server might cache.

### What protects the code

A six-digit code is a million possibilities, which is not many at network speed,
so **the limit on guesses is the security argument**. Five failures lock the
factor for fifteen minutes. Verification also records the accepted time step: a
code stays valid for its whole 30-second window, so without that an intercepted
code could be replayed inside it.

Secrets are stored encrypted with AES-256-GCM under a key derived from
`APP_KEY`. That means **rotating `APP_KEY` invalidates every enrolled secret** —
treat it as a migration requiring re-enrolment, not a config change.

Recovery codes are hashed with scrypt rather than SHA-256, unlike the URL tokens:
they are short and human-transcribed, so a fast hash would let a leaked table be
brute-forced offline. Each is single use, and using one is a full second factor.

### Passkeys

WebAuthn as a second factor, alongside TOTP behind the same verify endpoint.

```
GET    /api/auth/passkeys           # what is enrolled
POST   /api/auth/passkeys/options   # password required; options for credentials.create()
POST   /api/auth/passkeys/verify    # store the new credential
DELETE /api/auth/passkeys/:id       # password required
POST   /api/auth/passkey/options    # sign-in: options for credentials.get()
```

Configure the relying party before anyone enrols:

```env
APP_URL=https://example.com
WEBAUTHN_RP_ID=example.com          # defaults to the APP_URL hostname
WEBAUTHN_ORIGINS=https://example.com
```

**Passkeys are bound to the RP ID.** A credential enrolled on `example.com`
does not work on `app.example.com` unless you set the parent domain, and
changing it later invalidates every enrolled passkey. WebAuthn also requires a
secure context, so it works on HTTPS or `localhost` and nowhere else.

#### What is verified, and what is not

**Attestation is not verified.** Registration extracts the public key but does
not check the authenticator's certificate chain — that means parsing X.509,
tracking a metadata service, and deciding which manufacturers to trust.
Consumer sites do not do it, and doing it badly is worse than not doing it. The
options request asks for `attestation: "none"` accordingly. If you need to
prove a credential came from particular hardware, this is not enough.

**ES256 and RS256 only.** Between them they cover Apple, Google, Windows Hello
and every modern security key.

Everything else is checked, and each of these is an authentication bypass if
skipped rather than merely a bug: the ceremony type, so a registration cannot
be replayed as a sign-in; the challenge, compared in constant time against one
the server issued and stored; the origin, against an allowlist; the RP ID hash;
user presence, and user verification when required; that the credential
presented is the one being verified; and the signature itself.

The signature counter is checked when both sides report a non-zero value. Many
passkeys — Apple's and Google's included — always report zero, so zero means
"not supported" rather than "cloned".

### Using the primitives directly

```js
import { generateSecret, totp, verifyTotp, otpauthUri } from '@basicbenframework/core/auth/totp'

const secret = generateSecret()
const uri = otpauthUri({ secret, label: user.email, issuer: 'My App' })

const result = verifyTotp(secret, submittedCode, { lastStep: user.totp_last_step })
if (result.valid) {
  // persist result.step — this is the replay guard
}
```

---

## Roles & Permissions

Users have a role, and routes are gated on capabilities rather than on merely
being logged in. The first account to register becomes the `admin`; everyone
after defaults to `subscriber`.

| Role | Can |
|------|-----|
| `admin` | Everything, including settings and API tokens |
| `editor` | Create, edit, publish, and delete any content; moderate comments |
| `author` | Create and publish their own posts; upload media |
| `contributor` | Write their own drafts; cannot publish or upload |
| `subscriber` | Comment only |

Gate a route with `requireCapability`:

```js
import { requireCapability } from '@basicbenframework/core/auth/permissions'

export default (router) => {
  router.put('/api/settings', auth, requireCapability('settings.manage'), SettingsController.update)
}
```

Capabilities ending in `.own` apply only to records the user owns. Pass a
`loadResource` function and the check compares the record's `user_id` (or
`author_id`) against the current user:

```js
router.put(
  '/api/posts/:id',
  auth,
  requireCapability('post.edit', {
    loadResource: (req) => Post.find(Number(req.params.id))
  }),
  PostController.update
)
```

An `author` holds `post.edit.own`, so that route lets them edit their own posts
and returns 403 for anyone else's. An `editor` holds `post.edit` outright and
can edit all of them.

To check a capability directly:

```js
import { can } from '@basicbenframework/core/auth/permissions'

if (!can(req.user, 'post.publish')) {
  return res.json({ error: 'Forbidden' }, 403)
}
```

`req.user` is `{ id, role }`, populated by the auth middleware from the JWT.
Because the role travels in the token, a role change takes effect when the token
is reissued — reload the user and pass the fresh record to `can()` where that
matters.

---

## Headless API

A read-only content API at `/api/v1`, authenticated with tokens rather than
logins, alongside the bundled admin and SPA rather than instead of them. A blog
can be served by the built-in frontend today and by a static site generator
later without a rewrite.

### Tokens

Issue one at `/admin/tokens`. The plaintext is shown once and never again — only
a SHA-256 hash is stored, so a copy of the database does not hand over working
credentials.

```bash
curl https://example.com/api/v1/posts \
  -H "Authorization: Bearer bb_..."
```

The `bb_` prefix is what lets one `Authorization: Bearer` header carry either a
token or a user session: middleware picks the verifier from the prefix rather
than trying both.

Scopes are `content:read`, `content:write`, `media:read` and `media:write`. A
write scope grants the matching read. A token cannot manage tokens — otherwise a
leaked read-only credential could mint itself a write-scoped one.

### Endpoints

```
GET /api/v1/posts?page=&per_page=&category=&tag=&search=&format=
GET /api/v1/posts/:slug
GET /api/v1/pages
GET /api/v1/pages/:slug
GET /api/v1/categories
GET /api/v1/tags
GET /api/v1/media/:id
```

Only published content is returned. `:slug` also accepts a numeric id, since
slugs are nullable on posts. `per_page` is clamped to 100. Responses are
`{ data, meta }`.

`?format=markdown` returns the source instead of rendered HTML. Every item
reports the `format` it actually carries: a post written before HTML rendering
existed has no cached HTML, and the API falls back to Markdown and says so
rather than labelling Markdown as HTML. `basicben content:rerender` fills the
cache.

Comments are deliberately absent — that table stores `author_email` for
unauthenticated commenters.

### Public reads

Off by default. Set `public_api` to `true` in settings to serve content
anonymously, which is what lets a browser-side consumer read it without shipping
a token to the browser.

### Caching

Every read carries an `ETag` and `Cache-Control`, and `If-None-Match` gets a
`304` with no body. Static files get the same, plus `Accept-Ranges` and real
`206` responses so media can be seeked and resumed.

### Rate limits

120 requests a minute, per address. Every response carries `RateLimit-Limit`,
`RateLimit-Remaining` and `RateLimit-Reset`; a refused one adds `Retry-After`.

Per-token budgets would be better accounting, but a limiter has to run before
authentication — otherwise a flood of fabricated tokens is never limited — and
before authentication the token is unverified. Keying on an unverified string
would hand an attacker a fresh budget per fabricated token.

### CORS

```js
export default {
  cors: {
    origin: ['https://blog.example.com'],
    credentials: true
  }
}
```

`origin` takes a string, an array, or a function. `'*'` together with
`credentials: true` is refused with a warning rather than honoured — browsers
reject that pairing, so it would break every credentialed request silently.

---

## Testing

BasicBen uses Vitest for application tests:

```bash
basicben test              # Run once
basicben test --watch      # Watch mode
basicben test --coverage   # With coverage report
basicben test --ui         # Open Vitest UI
```

Create test files with `.test.js` or `.spec.js` suffix:

```js
// src/controllers/UserController.test.js
import { describe, it, expect } from 'vitest'
import { UserController } from './UserController.js'

describe('UserController', () => {
  it('returns users list', async () => {
    const res = { json: vi.fn() }
    await UserController.index({}, res)
    expect(res.json).toHaveBeenCalled()
  })
})
```

---

## Environment Variables

BasicBen uses Node 20's built-in `--env-file` support. No `dotenv` required.

Create a `.env` file at your project root:

```env
PORT=3000
DATABASE_URL=./database.sqlite
APP_KEY=your-secret-key
```

A `.env.example` is included in every new project. Commit that, not `.env`.

---

## Configuration

Override defaults in `basicben.config.js` at your project root:

```js
// basicben.config.js
export default {
  // Server port (API)
  port: 3001,

  // CORS settings.
  //
  // '*' with credentials: true is refused by browsers, so the framework warns
  // and drops the credentials header. Name your origins to allow credentialed
  // cross-origin requests:
  //
  //   origin: ['https://blog.example.com'],
  //   credentials: true
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: false
  },

  // Body parser. `skip` takes a path prefix, a list of them, or a predicate,
  // and leaves the request stream unread — which is what a route needing the
  // raw bytes requires. Webhook signature verification is the usual case.
  bodyParser: {
    limit: '1mb',
    skip: ['/api/webhooks/']
  },

  // Static files
  static: {
    dir: 'public',
    // Serve index.html for unmatched client routes so deep links and refreshes
    // work in production. API paths and requests for files with an extension
    // fall through, so they still 404 correctly.
    spa: true
  },

  // Database — 'sqlite', 'postgres' or 'turso'.
  // Omit driver and it is inferred from the URL scheme.
  db: {
    driver: 'sqlite',
    url: process.env.DATABASE_URL || './data.db'
  },

  // Auto-load routes from src/routes (default: true)
  autoloadRoutes: true,

  // Auto-load middleware from src/middleware (default: true)
  autoloadMiddleware: true
}
```

---

## Hook System

BasicBen includes a WordPress-inspired hook system for extensibility:

```js
import { hooks, HOOKS } from '@basicbenframework/core'

// Register a callback
hooks.on(HOOKS.REQUEST_BEFORE, async (ctx) => {
  console.log('Request:', ctx.req.url)
  return ctx
})

// Fire a hook
await hooks.fire('custom.event', { data: 'value' })

// Filter data through callbacks
const result = await hooks.filter('content.render', htmlContent)
```

### Actions vs Filters

Hooks come in two flavors:

- **Actions** are fired with `hooks.fire(name, ctx)`. Callbacks run for side effects (logging, notifications, cache invalidation). The return value is **ignored** — if you mutate `ctx`, the mutation is visible to later callbacks and to the caller.
- **Filters** are fired with `hooks.filter(name, value, ctx)`. Each callback receives the previous callback's return value, and the final value is returned to the caller. Return `undefined` to pass the current value through unchanged.

Errors thrown inside a callback are caught and logged — they do not abort the chain.

### Available Hooks

| Hook | Type | Description |
|------|------|-------------|
| `server.starting` | action | Before server starts |
| `server.started` | action | Server is ready |
| `request.before` | action | Before route handler |
| `request.after` | action | After route handler |
| `post.created` | action | After post is created |
| `comment.created` | action | After comment is created |
| `content.render` | filter | Transform rendered HTML |

---

## Updating

Through your package manager, like any other dependency:

```bash
npm install @basicbenframework/core@latest
```

Then redeploy. There is no in-app updater and no self-update command: on any
host that rebuilds from an image — Docker, Fly, Railway, Render, a serverless
platform — a server that rewrote its own files would lose the change on the next
deploy. Your lockfile is the record of which version you run.

---

## Dependencies

BasicBen has **zero runtime dependencies**:

```json
{
  "dependencies": {},
  "peerDependencies": {
    "react": ">=18",
    "react-dom": ">=18",
    "vite": ">=7",
    "@vitejs/plugin-react": ">=5"
  },
  "optionalDependencies": {
    "pg": ">=8"
  }
}
```

SQLite uses Node's built-in `node:sqlite` module — no native dependency to install. Install `pg` only if you're using Postgres.

**Everything is written from scratch:**

- HTTP server (uses node:http)
- CLI argument parser (no Commander)
- Router with groups, middleware, named routes
- Validation (no Zod/Joi)
- JWT auth (no jsonwebtoken, uses node:crypto)
- Migrations (no Knex/Sequelize)
- Environment variables (uses Node's built-in --env-file)

---

## Guiding Principles

1. **Write it yourself before adding a dependency** — if it's under 200 lines, own it
2. **Conventions over configuration** — sensible defaults, optional overrides
3. **Error messages are features** — tell you exactly what went wrong and how to fix it
4. **Stay boring** — resist clever abstractions until they're obviously needed

---

## Contributing

BasicBen is early. Contributions, issues, and ideas are welcome.

```bash
git clone https://github.com/BasicBenFramework/core
cd core
npm install
npm run dev
```

Please read `CONTRIBUTING.md` before opening a PR.

---

## Inspiration

BasicBen takes cues from Laravel's developer experience — migrations, controllers, models, and scaffolding commands that feel familiar to PHP developers. If you've used Laravel and wished the JS ecosystem felt that good, this is for you.

---

## License

MIT
