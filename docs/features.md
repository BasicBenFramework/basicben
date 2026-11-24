# Features

A feature is something the CMS does that the core does not need. Three ship
with the CMS: `analytics`, `members` (with newsletters and the access policy)
and `theme` (the server-rendered public site and oEmbed). Each one is a
folder in `src/features/` that plugs into the core through a small host. Delete
the folder and its line in each of the three lists, and the core still builds,
passes its tests and runs. `npm test` checks that on every import.

**This is an internal API.** It exists so the CMS can be split cleanly and may
change in any release. It is not yet a contract for third-party plugins.

## A feature's folder

```
src/features/<name>/
  index.ts       server half: { name, register(host) }
  admin.tsx      admin half: { name, register(admin) }       (optional)
  manifest.ts    static data: admin pages, export tables      (no runtime imports)
  i18n/<code>.ts the feature's own translations              (optional)
  *.test.js      the feature's tests, run by npm test
  README.md      what it does and why
```

It is turned on by one line in each list, in the same order:

| List | Imports |
|---|---|
| `src/features.ts` | `./features/<name>/index.ts` |
| `src/client/features.ts` | `../features/<name>/admin` |
| `src/features.manifest.ts` | `./features/<name>/manifest.ts` |

The manifest is separate because the export and backup scripts read it with
plain Node, without booting the server or a database.

## The rules

- **Core never imports a feature**, except through those three lists.
- **Order matters for routes.** Features' routes are mounted after core's, in
  list order. The theme catches `/:slug`, so it stays last.
- **Features never import each other.** Two features that need to talk do it
  through hooks.
- **A feature may import core freely**: models, helpers, middleware. The host
  only covers what a feature could not do without editing a core file.
- **Migrations stay in `db/migrations/`.** A removed feature leaves its tables
  behind, empty and harmless. Nothing is dropped automatically.

## The server host

`register(host)` runs once at boot, before routes are mounted.

| Call | Does |
|---|---|
| `host.routes((router) => { … })` | Adds routes, mounted after core's, in list order |
| `host.settings.define({ key: { group, check } })` | Opens `PUT /api/settings` to the feature's keys. Validators are `checks` in `helpers/site-settings.ts`. A key core already owns is refused at boot |
| `host.cron.task(name, everySeconds, run)` | Runs `run` at most that often, as `<feature>:<name>` |
| `host.health.check(name, run)` | Adds to the site health page. Return `null` to add nothing; a check that throws shows as a warning |
| `host.access.policy({ levels, headers, identify, mayRead })` | Become the site's one access policy (below). A second registration throws at boot |
| `host.hooks` | The framework's hooks. A `post.creating` / `post.updating` filter may refuse a save with `{ cancel: true, reason, status: 403 }`; any other status is 422 |

## The admin host

| Call | Does |
|---|---|
| `admin.page(path, Component)` | The screen for a page the manifest declares. A page not in the manifest is refused, so the menu and the routes cannot disagree |
| `admin.fill(slot, Component)` | Adds to a named place in a core screen: `post.editor.sidebar` (below) or `settings.reading`, a card after Settings' Reading section that gets `SettingsSectionProps` (`values`, `onChange`) and is saved with the form |
| `admin.dictionaries({ es: () => import('./i18n/es') })` | Translations, merged over the admin's own when the language loads |

A manifest page's `label` and `section` go through `t()` like core's menu, so
they belong in the feature's dictionary. A page needs an `iconPath`, an SVG
path on the admin's 24×24 grid, because core's icon set does not know it.

## Access

Who may read a restricted post is split in two. Core owns the mechanism in
`helpers/access.ts` and `helpers/gating.ts`: every surface that serves a body
(the content API, the feeds, the built-in blog, the theme) withholds it the
same way, with the body, custom fields and a whole-body excerpt removed,
`gated` set and the response marked private. One feature owns the policy:

```ts
host.access.policy({
  levels: ['members', 'paid'],     // offered in the editor, beside public
  headers: ['X-Member-Token'],     // treated like Authorization for caching
  identify: (req) => reader | null,
  mayRead: (post, reader) => boolean
})
```

- **Deny by default.** With no policy, public posts are readable and nothing
  else is. A site that removes the members feature keeps its members-only
  posts withheld, from everyone.
- **A policy that throws** denies, and its reader counts as anonymous.
- **The editor** accepts `public`, a level the policy offers, or the level
  the post already has, so a post saved under a removed feature can still be
  edited without being published by accident.

CORS's `allowedHeaders` stays in `basicben.config.js`; the config loads
before features do.

## The post editor's sidebar

A `post.editor.sidebar` fill gets `PostEditorSidebarProps`: `kind`, `postId`,
the `record` as loaded, `values` (the post's `visibility` and anything fills
have set) and `onChange(changes)`. Whatever a fill sets is sent with the next
save. Core does not know what it means; the feature's server half reads it
from the request in a `post.creating` / `post.updating` filter, which runs
inside core's save, so a post that has never been saved can carry it too.
That is how the members feature saves `send_newsletter`.

## Cron

Core and every feature share one entry point:

- `GET /api/cron/tick` with `Authorization: Bearer $CRON_SECRET` runs whatever
  is due. Without `CRON_SECRET` the route answers 404.
- On a long-running server an in-process interval calls the same tick every
  minute. It does not run on Vercel, where nothing outlives a request.

Each task records its last run in `ops_heartbeats` as `cron:<name>`, so "due"
is shared by every serverless instance. A task that throws is logged, recorded
and retried at its next interval. Tasks run one after another within a 25
second budget, and anything left is due at the next tick.

`/api/cron/maintenance` and the members feature's `/api/cron/newsletters`
are kept as aliases.

On Vercel, schedule the tick in `vercel.json`. The Hobby plan allows one run a
day, which is enough for the analytics purge. It is not enough for scheduled
publishing or newsletters, which want a run every minute or so from an external
scheduler:

```json
{ "crons": [{ "path": "/api/cron/tick", "schedule": "0 4 * * *" }] }
```

## Checking a feature can be removed

```bash
rm -rf src/features/<name>     # in a scratch copy
# delete its line in the three lists
npx tsc --noEmit -p . && npm run build && npm test && ./scripts/smoke-test.sh
```

The smoke test checks a feature's endpoints only when the feature is listed.
