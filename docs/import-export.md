# Import and export

Everything here runs as a script against the database the app uses
(`DATABASE_URL`, `TURSO_URL` or `basicben.config.js`, resolved exactly as
`basicben migrate` resolves it). Every importer:

- has `--dry-run`, which runs the real import inside a transaction and rolls it
  back, so the report it prints is what a real run would do;
- matches on natural keys (slug for posts, pages and terms; email for users;
  object key for media; key for settings) and **leaves existing rows alone**
  unless `--update` is passed, so re-running is safe;
- never modifies an existing user account, even with `--update`;
- converts HTML to Markdown the same way (`src/cli/lib/html-to-markdown.mjs`)
  and stores the source HTML, sanitized, as `content_html`;
- keeps original slugs and dates;
- ends with a summary of what was created, matched, updated and skipped, and
  notes about anything that could not be carried across.

An admin account must exist in the target first: content whose author did not
come across is attributed to the first admin.

| Source | Command |
| --- | --- |
| BasicBen export | `npm run import:json -- FILE.json [--dry-run] [--update]` |
| WordPress export file (WXR) | `npm run import:wxr -- FILE.xml [--dry-run] [--update]` |
| Live WordPress (REST API) | `npm run import:wordpress -- --url https://old.site [--dry-run] [--update]` |
| Ghost export (4.x / 5.x) | `npm run import:ghost -- FILE.json --url https://old.site [--dry-run] [--update]` |
| Export this site | `npm run export -- [--out FILE] [--revisions]`, or Admin → Tools |

(`npm run` scripts load `.env` if present; `node --env-file=.env scripts/<name>.mjs`
is equivalent.)

## The export format (version 1)

One JSON document:

```json
{
  "format": "basicben-export",
  "version": 1,
  "exported_at": "2026-11-23T10:00:00.000Z",
  "driver": "sqlite",
  "options": { "revisions": false },
  "tables": {
    "users": [ { "id": 1, "name": "…", "email": "…", "role": "admin", "slug": "…", … } ],
    "media": [ … ],
    "categories": [ … ],
    "tags": [ … ],
    "posts": [ … ],
    "post_categories": [ { "post_id": 1, "category_id": 2 } ],
    "post_tags": [ { "post_id": 1, "tag_id": 3 } ],
    "post_revisions": [ … ],
    "pages": [ … ],
    "comments": [ … ],
    "settings": [ { "key": "site_name", "value": "…", "group_name": "general", … } ],
    "menus": [ … ],
    "menu_items": [ … ],
    "redirects": [ … ]
  },
  "counts": { "users": 1, "posts": 42, … },
  "omitted": {
    "tables": [ { "name": "auth_tokens", "reason": "credentials or per-database state" } ],
    "columns": { "users": ["password", "token_version"] },
    "settings": ["smtp_password"]
  }
}
```

- **Rows are the database's own rows**, column for column, with the exceptions
  in `omitted`. Their meaning is the schema's: see `db/migrations`.
- **Tables are in dependency order.** A row refers only to rows in tables
  before it, or to its own table (`categories.parent_id`, `pages.parent_id`,
  `comments.parent_id`). Ids are the source database's and are remapped on
  import.
- A table that does not exist in the source is absent (not an empty array).
  `post_revisions` is present only when the export was asked for revisions
  (`--revisions`, or the checkbox in Tools).
- `menus`, `menu_items`, `redirects` and `snippets` are exported when those
  tables exist. Comments are exported without `author_ip` (a spam signal for
  this install, and personal data), and edit locks (`post_locks`) never are. Any other table the export does not know is listed in
  `omitted.tables` — the list of exported tables is an allowlist, so a new
  table is never exported by accident.
- Dates are whatever the database stored: ISO-8601 strings, or
  `YYYY-MM-DD HH:MM:SS` (UTC) for rows written by SQLite's
  `CURRENT_TIMESTAMP`.

### Never exported

| What | Where |
| --- | --- |
| Password hashes, session versions | `users.password`, `users.token_version` |
| Email verification / password reset tokens | `auth_tokens` |
| TOTP secrets and recovery codes | `user_two_factor` |
| Passkeys | `user_credentials` |
| API token hashes | `api_tokens` |
| Rate-limiter state | `rate_limits` |
| Migration bookkeeping | `_migrations` |
| Settings whose key looks like a credential (`secret`, `password`, `token`, `api_key`, `private_key`, `credential`) | listed in `omitted.settings` |

Media files are not in the export — only their rows. Copy the bucket (or
`public/uploads`) separately; rows point at the same object keys.

### Versioning

`version` is bumped for any change an older importer would misread. The
importer refuses a version newer than it knows, rather than guessing.
Adding a table or a column is not such a change: importers drop columns the
target does not have and skip tables it does not have, with a note.

### Importing an export

`basicben-cms import:json`:

- Users are matched on email. New users keep their exported role (it is the
  same site moving) but get a password nothing matches: each signs in with
  "forgot password", which also verifies the address. Two-factor, passkeys and
  API tokens must be set up again.
- Posts, pages, terms and media are matched on slug / path; settings on key.
  Credential-looking settings are refused even if present in the file.
- Term assignments are written for posts this run creates or updates.
  Revisions are imported only for posts this run creates.
- Comments are matched on post, `created_at` and content.
- Menus, menu items, redirects and snippets go through a generic path:
  matched on the first of `slug`, `key`, `from_path`, `source_path`,
  `source`, `from`, `path`, `location`, `name` the table has; `*_id` columns
  are remapped when they name a known table (`menu_id` → menus, `parent_id` →
  the same table), and `created_by` → users. Menu links (`target_type` +
  `target_id`) are remapped through the table `target_type` names, and an item
  whose target was not imported is skipped rather than left pointing at
  whatever row has the old id. A table with no such column (menu items) is
  imported only into a target that has none yet, so re-running adds nothing.

## WordPress export file (WXR)

`basicben-cms import:wxr` reads the XML from wp-admin → Tools → Export → All
content. Offline: the old site need not be running. The XML parser
(`src/cli/lib/xml.mjs`) refuses DTDs and decodes only XML's five entities and
numeric references, so a hostile file cannot expand entities.

| WordPress | Here |
| --- | --- |
| Post, page | post, page (`wp:post_name` is the slug) |
| `publish` | published, `publish_at` = `post_date_gmt` |
| `future` | published, future `publish_at` (goes live on schedule; webhooks fire then) |
| `draft`, `pending` | draft, pending |
| `private` | **draft** — there is no private visibility here, and publishing it would expose it |
| `trash`, `auto-draft`, revisions, menu items, custom post types | not imported (counted in notes) |
| Page parent, `menu_order`, `_wp_page_template` | `parent_id`, `menu_order`, `template` (`page-templates/full-width.php` → `full-width`) |
| Categories (with parent), tags | categories (hierarchy kept), tags; first category is the primary one |
| Authors | `author`-role accounts with no usable password; matched by email to existing accounts, which are left unchanged |
| Comments: approved `1` / `0` / `spam` / `trash` | approved / pending / spam* / not imported; threading kept; pingbacks and trackbacks not imported |
| Attachments | media rows at the file's object key, with width/height/filesize from `_wp_attachment_metadata` and alt text |
| `_thumbnail_id` | featured image |
| Yoast `_yoast_wpseo_*` | meta title/description, canonical, og/twitter title/description/image, noindex (titles that are only `%%template%%` variables are dropped) |

Content is the raw `post_content`, so classic-editor posts go through an
`autop` pass (WordPress adds `<p>` at render time); block-editor content is
already HTML. `[caption]` becomes a figure with its caption and `[embed]` a
link; other shortcodes are left visible for an editor to replace.

\* Spam is imported with `status = 'spam'` (migration 030), so it lands in the
admin's Spam tab rather than the moderation queue. Against an older schema with
no status column it is skipped and counted instead.

## WordPress REST API

`basicben-cms import:wordpress` reads a live site: posts, pages, categories,
tags, comments, authors and the whole media library. Anonymously it sees only
published content, approved comments and no author emails (new accounts get
`<slug>@imported.invalid` — fix those before anyone resets a password). Set
`WORDPRESS_AUTH=user:application-password` to also get drafts, scheduled,
pending and private posts, held and spam comments, and author emails.
`--no-authors` keeps the old behaviour of attributing everything to the first
admin.

**Changed:** existing posts used to be updated on every run. They are now left
alone unless `--update` is passed — use it on the final run before cut-over.

## Ghost

`basicben-cms import:ghost` reads Settings → Labs → Export (Ghost 4 and 5; the
`{ db: [ { meta, data } ] }` wrapper is optional).

| Ghost | Here |
| --- | --- |
| `html` | converted to Markdown (falls back to a Mobiledoc Markdown card, then `plaintext`); Lexical/Mobiledoc themselves are not interpreted |
| `published` / `scheduled` | published (future `publish_at` for scheduled) |
| `draft` / `sent` | draft (`sent` is an email-only newsletter, never on the web) |
| `type: page` | page |
| Public tags | tags, in Ghost's order |
| Primary (first) tag | **also** a category, set as the post's primary category — Ghost themes use it the way other CMSes use a category. `--no-primary-category` turns this off |
| Internal tags (`#name`) | not imported |
| `posts_meta` (v4+) or post fields (v3) | meta title/description, og/twitter title/description/image |
| `canonical_url`, `custom_excerpt`, `feature_image` (+ alt) | the same fields |
| Users | `author`-role accounts (Ghost roles are ignored), with bio, website and avatar |
| Members-only / paid visibility | imported as ordinary posts; counted in the notes because there is no gating here |

Pass `--url https://your-ghost-site` (or `GHOST_URL`) so `__GHOST_URL__` in
image and link URLs resolves; without it those images are left unset. Ghost
exports contain no comments.

## Known gaps

- **Media files are not downloaded.** Rows record the existing object key and
  resolve through `storage.publicUrl`, so images display when storage points at
  the host already serving them (`S3_PUBLIC_URL`). Otherwise move the files
  first, keeping their paths.
- Images *inside* post bodies keep their original absolute URLs.
- WordPress menus, widgets, custom fields and custom post types are not
  imported. Redirects from old permalinks are not created.
- Ghost newsletters, members, tiers and code injection are not imported.
- Imported HTML is sanitized with the CMS allowlist, so embeds (iframes) do
  not survive in `content_html`; the Markdown keeps them as links.
