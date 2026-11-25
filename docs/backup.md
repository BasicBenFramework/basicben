# Backups

`npm run backup` writes a full, timestamped backup of the site; `npm run
restore` loads one into an empty database. Both run from a shell on a
machine that can reach the database — a cron box, CI, or your laptop with the
production `.env` — never from a request, because a large site takes longer
than a serverless function is allowed to run.

```sh
npm run backup -- --gzip --s3 --keep 14
```

## Read this first: backups contain personal data

A backup holds every account's name and email address, and the name and email
of everyone who left a comment. Treat the files accordingly:

- store them encrypted, somewhere only the people who run the site can read;
- keep as few as you need (`--keep`), and delete them when someone asks to be
  forgotten — a backup is a copy of their data too;
- never put them in a public bucket. See [Uploading](#uploading-to-a-bucket).

A backup contains **no secrets**: no password hashes, two-factor secrets,
passkeys, API or email tokens, rate-limiter state, or settings whose name
looks like a credential. (The export that backups are built on omits them,
and the optional SQLite copy has them deleted before it is written.) Your
`.env` is not backed up — keep APP_KEY, WEBHOOK_SECRET and the rest in your
host's secret store.

## What is in a backup

- **`basicben-backup-<time>-<random>.json[.gz]`** — the full JSON export
  (the same format as Tools → Export, see [import-export.md](import-export.md)),
  **with revision history**. Portable between SQLite, Turso and Postgres.
- **`basicben-backup-<time>-<random>.sqlite`** (with `--sqlite-copy`, SQLite
  only) — a consistent snapshot of the database file, made with `VACUUM INTO`
  while the app keeps running, with credentials scrubbed out and the file
  vacuumed again so deleted rows are not recoverable from free pages. It keeps
  everything the JSON leaves out: original ids, analytics counts, `_migrations`.

Not in a backup: **media files**. A backup records each file's address in your
storage bucket; the files stay in the bucket. Back the bucket up with your
provider (R2, S3 and B2 all offer versioning or replication), or copy
`public/uploads` if you use local storage.

The file names carry a random tail so they cannot be guessed from the time.

## Options

| Option | |
| --- | --- |
| `--dir DIR` | Where to write. Default `./backups` (git-ignored, created with mode 700). |
| `--gzip` | Compress the JSON. A text-heavy export shrinks five- to tenfold. |
| `--sqlite-copy` | Also write the scrubbed SQLite snapshot. Refused on Turso and Postgres. |
| `--s3` | Upload the files (see below). |
| `--prefix NAME` | Folder in the bucket. Default `backups/`. |
| `--keep N` | Keep the newest N backups and delete older ones — in `--dir`, and in the bucket with `--s3`. Only files named like backups are ever deleted. |
| `--no-revisions` | Leave post revision history out. |
| `--remove-local` | With `--s3`, delete the local files once uploaded. |

Each successful run is recorded, and **Site health** shows when the last one
was — and warns if it was more than eight days ago.

## Uploading to a bucket

Uploads use the framework's own S3 client (SigV4 over `fetch`; no SDK), so any
S3-compatible store works: R2, S3, B2, MinIO, Spaces.

**Use a separate, private bucket.** Set:

```sh
BACKUP_S3_BUCKET=my-blog-backups
BACKUP_S3_ACCESS_KEY_ID=…
BACKUP_S3_SECRET_ACCESS_KEY=…
BACKUP_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com   # omit for AWS
BACKUP_S3_REGION=auto
```

Any `BACKUP_S3_*` you leave out falls back to the media bucket's matching
value, so a second bucket on the same account needs only `BACKUP_S3_BUCKET`.
Give the backup key write access to the backup bucket only.

The media bucket is whichever uploads use: the `S3_*` variables when
`S3_BUCKET` is set, otherwise the bucket in **Settings → Media Storage** (read
from the database and decrypted with `APP_KEY`, so the command needs the same
`APP_KEY` as the site).

Without `BACKUP_S3_BUCKET`, backups go to the **media** bucket under
`backups/`. That works, but a media bucket is usually public — an R2 bucket
with a custom domain serves every key in it — and the script warns when the
media bucket has a public URL. The random file names make a
backup hard to find; a private bucket makes it impossible.

Prefer a lifecycle rule on the bucket (expire `backups/` after N days) over
`--keep` if your provider has one: it keeps working when the job does not.

## Scheduling

Any scheduler that can run Node 24 with the production environment:

```cron
# 03:15 every day: gzip, upload, keep two weeks.
15 3 * * *  cd /srv/blog && npm run backup -- --gzip --s3 --keep 14 --remove-local
```

On Vercel there is no shell to run it from; use a GitHub Actions schedule (or
any CI) with the database and bucket secrets, and rely on Turso's own
point-in-time recovery for the minutes in between.

## Restoring

```sh
npm run migrate                                   # a fresh database, current schema
npm run restore -- backups/basicben-backup-….json.gz --dry-run
npm run restore -- backups/basicben-backup-….json.gz --reset-password you@example.com
```

- The target must be **empty** — no users, posts, pages, comments, media or
  terms. A restore refuses anything else, because restoring over a live site
  is rarely what anyone meant. `--force` merges instead, with the importer's
  usual rules (existing rows matched by slug or email and left alone).
- `--dry-run` runs the entire restore inside a transaction and rolls it back,
  so what it reports is exactly what a real run would do.
- The real run is one transaction too: if it fails partway, the database is
  left empty, not half-restored.
- `--s3 KEY` reads the backup straight from the backup bucket.
- Accounts come back with their roles but **no password** (backups never carry
  one). Everyone signs in with "forgot password" — which needs working email —
  or use `--reset-password EMAIL` to give one admin a random temporary
  password, printed once.
- Two-factor and passkeys must be set up again; API tokens re-issued.

### Restoring a SQLite copy

A `.sqlite` backup is already a database. Stop the app, put the file where
`DATABASE_URL` points, start it, and run `npm run migrate` in case the backup
predates a migration. Passwords were scrubbed from this copy as well, so
everyone signs in with "forgot password", the same as after a JSON restore.

## Checking a backup

A backup you have never restored is a hope, not a backup. Occasionally:

```sh
DATABASE_URL=/tmp/restore-test.sqlite npm run migrate
DATABASE_URL=/tmp/restore-test.sqlite npm run restore -- backups/<latest>.json.gz --dry-run
```
