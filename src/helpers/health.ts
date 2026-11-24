/**
 * Site health: is this deployment configured the way production needs?
 *
 * Two halves. `gatherFacts` reads the database and the filesystem; the
 * `evaluateHealth` half is a pure function from those facts (and the
 * environment) to a list of checks, each pass / warn / fail with a fix. The
 * split is what lets every rule be tested with a plain object, and keeps the
 * one rule that matters most — **never echo a secret** — in a single place:
 * secrets reach `evaluateHealth` only as the environment, and every check
 * about one reports presence and length, never the value. Connection strings
 * are summarised to a driver name for the same reason: a DATABASE_URL carries
 * its password.
 *
 * Imports nothing outside `node:` so the tests (and a future CLI) can load it
 * directly.
 */

import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'

export type HealthStatus = 'pass' | 'warn' | 'fail'

export interface HealthCheck {
  id: string
  label: string
  status: HealthStatus
  /** What was found, for a person. Never a secret value. */
  message: string
  /** What to do about it. Empty when nothing needs doing. */
  hint: string
}

export interface HealthFacts {
  nodeVersion: string
  frameworkVersion: string | null
  dbDriver: string
  /** Migration files this deployment can see, or null when the directory is not shipped. */
  migrationFiles: string[] | null
  /** Migrations recorded as run in `_migrations`. */
  migrationsRan: string[]
  storageDriver: string
  /** A transport name (`console`, `smtp`, `resend`, `http`), or `custom` for a function. */
  mailTransport: string
  mailFrom: string | null
  settings: { public_api?: string; webhook_urls?: string }
  heartbeats: Record<string, { last_run_at: string; detail: Record<string, unknown> | null }>
  /** Scheduled posts that are live but have not been announced. */
  dueUnannounced: number
  rateLimitRows: number | null
  adminsTotal: number
  /** Active admin accounts with no TOTP second factor. */
  adminsWithout2fa: number
}

/** A serverless platform: read-only disk, no long-running process. */
export function isServerless(env: Record<string, string | undefined>): boolean {
  return Boolean(env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME || env.NETLIFY || env.K_SERVICE)
}

const MIN_APP_KEY = 32
const DAY = 86_400_000

export function check(id: string, label: string, status: HealthStatus, message: string, hint = ''): HealthCheck {
  return { id, label, status, message, hint }
}

/** "3 minutes ago", for heartbeats. */
export function ago(iso: string, now: Date): string {
  const ms = now.getTime() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return 'at an unknown time'
  if (ms < 90_000) return 'just now'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 90) return `${minutes} minutes ago`
  const hours = Math.round(minutes / 60)
  if (hours < 36) return `${hours} hours ago`
  return `${Math.round(hours / 24)} days ago`
}

/** Pending migrations: files present that `_migrations` has no row for. */
export function pendingMigrations(files: string[], ran: string[]): string[] {
  const done = new Set(ran)
  return files.filter((name) => !done.has(name))
}

/**
 * Every check, worst first is the caller's business; this returns them in a
 * fixed order so the page does not shuffle between loads.
 */
export function evaluateHealth(
  env: Record<string, string | undefined>,
  facts: HealthFacts,
  now: Date = new Date()
): HealthCheck[] {
  const production = env.NODE_ENV === 'production'
  const serverless = isServerless(env)
  const checks: HealthCheck[] = []

  // --- Secrets and environment -----------------------------------------------

  const appKey = env.APP_KEY ?? ''
  if (!appKey) {
    checks.push(check('app_key', 'APP_KEY', 'fail', 'Not set.',
      'Set APP_KEY to a random string of at least 32 characters: node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"'))
  } else if (appKey === 'your-secret-key-here') {
    checks.push(check('app_key', 'APP_KEY', 'fail', 'Still the placeholder from .env.example.',
      'Generate a real key. Changing it signs everyone out, which is the point if the placeholder was ever live.'))
  } else if (appKey.length < MIN_APP_KEY) {
    checks.push(check('app_key', 'APP_KEY', production ? 'fail' : 'warn', `Set, ${appKey.length} characters (minimum ${MIN_APP_KEY}).`,
      'A short key can be brute-forced offline from any session it signed. Generate a longer one.'))
  } else {
    checks.push(check('app_key', 'APP_KEY', 'pass', `Set, ${appKey.length} characters.`))
  }

  checks.push(production
    ? check('node_env', 'NODE_ENV', 'pass', 'production')
    : check('node_env', 'NODE_ENV', serverless ? 'fail' : 'warn', `${env.NODE_ENV || 'unset'} — production safeguards are off.`,
      'Set NODE_ENV=production on any deployment people use. It turns on the APP_KEY and URL checks and stops the dev-only fallbacks.'))

  const [major] = facts.nodeVersion.split('.').map(Number)
  checks.push(major >= 24
    ? check('node_version', 'Node.js', 'pass', `v${facts.nodeVersion}`)
    : check('node_version', 'Node.js', 'fail', `v${facts.nodeVersion}; 24 or newer is required.`,
      'The SQLite driver and TypeScript stripping need Node 24. Upgrade the runtime (on Vercel: Project Settings → Node.js Version).'))

  checks.push(check('framework_version', 'Framework', facts.frameworkVersion ? 'pass' : 'warn',
    facts.frameworkVersion ? `@basicbenframework/core ${facts.frameworkVersion}` : 'Could not read the installed version.',
    facts.frameworkVersion ? '' : 'Run npm ci; the framework package may be missing from this deployment.'))

  // --- Database --------------------------------------------------------------

  const driver = facts.dbDriver
  if (driver === 'sqlite' && serverless) {
    checks.push(check('database', 'Database', 'fail', 'SQLite file on a serverless host.',
      'The disk here is ephemeral: every cold start gets an empty database. Use Turso (TURSO_URL + TURSO_AUTH_TOKEN) or Postgres (DATABASE_URL).'))
  } else if (driver === 'sqlite' && production) {
    checks.push(check('database', 'Database', 'warn', 'SQLite file.',
      'Fine on one persistent server — make sure the file is on a volume that survives redeploys, and back it up (npm run backup).'))
  } else {
    checks.push(check('database', 'Database', 'pass', `${driver}`))
  }

  if (facts.migrationFiles === null) {
    checks.push(check('migrations', 'Migrations', 'warn',
      `${facts.migrationsRan.length} recorded as run; this deployment does not ship its migration files, so pending ones cannot be listed.`,
      'Run `npm run migrate:status` from a checkout against the production database after each deploy.'))
  } else {
    const pending = pendingMigrations(facts.migrationFiles, facts.migrationsRan)
    checks.push(pending.length
      ? check('migrations', 'Migrations', 'fail', `${pending.length} pending: ${pending.slice(0, 5).join(', ')}${pending.length > 5 ? ', …' : ''}`,
        'Run `npm run migrate` against this database. Features whose tables are missing will error until you do.')
      : check('migrations', 'Migrations', 'pass', `All ${facts.migrationFiles.length} applied.`))
  }

  // --- Storage and mail ------------------------------------------------------

  if (facts.storageDriver === 'local') {
    checks.push(serverless
      ? check('storage', 'Media storage', 'fail', 'Local disk on a serverless host — uploads cannot work.',
        'Configure object storage: S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_ENDPOINT, S3_PUBLIC_URL (R2, S3, B2, MinIO all work).')
      : check('storage', 'Media storage', production ? 'warn' : 'pass', 'Local disk (public/uploads).',
        production ? 'Uploads live on this machine only and are not in the JSON backup. Use object storage, or back the directory up separately.' : ''))
  } else {
    const publicUrl = Boolean(env.S3_PUBLIC_URL)
    checks.push(check('storage', 'Media storage', publicUrl ? 'pass' : 'warn',
      `${facts.storageDriver} (bucket set, access key ${env.S3_ACCESS_KEY_ID ? 'set' : 'missing'}, secret ${env.S3_SECRET_ACCESS_KEY ? 'set' : 'missing'}${publicUrl ? ', public URL set' : ''}).`,
      publicUrl ? 'Use "Run storage probe" to confirm the credentials can write, read and delete.' : 'Set S3_PUBLIC_URL to the bucket\'s public or CDN address, or media URLs point at the private API host.'))
  }

  if (facts.mailTransport === 'console') {
    checks.push(check('mail', 'Email', production ? 'warn' : 'pass', 'Console transport — mail is printed to the log, not sent.',
      production ? 'Set RESEND_API_KEY, or configure SMTP in basicben.config.js. Until then password resets, invitations and verification emails go nowhere.' : ''))
  } else {
    const testSender = /onboarding@resend\.dev/i.test(facts.mailFrom ?? '')
    checks.push(check('mail', 'Email', testSender && production ? 'warn' : 'pass',
      `${facts.mailTransport} transport${facts.mailFrom ? `, from ${facts.mailFrom}` : ''}.`,
      testSender && production ? "MAIL_FROM is Resend's test sender, which only delivers to your own Resend account. Set MAIL_FROM to an address on a verified domain." : 'Use "Send test email" to confirm delivery.'))
  }

  // --- URLs and proxies ------------------------------------------------------

  const publicUrl = env.SITE_URL || env.APP_URL || ''
  const which = env.SITE_URL ? 'SITE_URL' : 'APP_URL'
  if (!publicUrl) {
    checks.push(check('site_url', 'Site URL', production ? 'fail' : 'warn', 'Neither SITE_URL nor APP_URL is set.',
      'Set APP_URL (this app) and SITE_URL (the public front end, if separate). Feeds, the sitemap and email links are built from them.'))
  } else {
    let url: URL | null = null
    try { url = new URL(publicUrl) } catch { /* reported below */ }

    if (!url) {
      checks.push(check('site_url', 'Site URL', 'fail', `${which} is not a valid URL.`, 'Use a full origin such as https://example.com.'))
    } else if (production && url.protocol !== 'https:') {
      checks.push(check('site_url', 'Site URL', 'fail', `${which} is ${url.origin} — not https.`,
        'Serve the site over https and update the variable. Links in feeds and emails use it as written.'))
    } else if (production && /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(url.hostname)) {
      checks.push(check('site_url', 'Site URL', 'warn', `${which} points at ${url.hostname}.`, 'Set it to the public address.'))
    } else {
      checks.push(check('site_url', 'Site URL', 'pass', `${which} = ${url.origin}`))
    }
  }

  const trust = env.TRUST_PROXY ?? ''
  const validTrust = trust === '' || trust === 'true' || trust === 'false' || /^\d+$/.test(trust)
  if (!validTrust) {
    checks.push(check('trust_proxy', 'TRUST_PROXY', 'warn', 'Set to a value it does not understand; treated as off.',
      'Use `true` (one proxy) or the number of proxies in front of the app.'))
  } else if ((trust === '' || trust === 'false') && serverless) {
    checks.push(check('trust_proxy', 'TRUST_PROXY', 'warn', 'Off, behind a platform proxy.',
      'Every visitor appears to come from the platform\'s proxy, so they share one rate-limit bucket. Set TRUST_PROXY=1 on Vercel.'))
  } else if (/^\d+$/.test(trust) && Number(trust) > 3) {
    checks.push(check('trust_proxy', 'TRUST_PROXY', 'warn', `Trusts ${trust} proxies.`,
      'More hops than any real chain usually has. If too many are trusted, the client chooses its own address and walks past every rate limit.'))
  } else {
    checks.push(check('trust_proxy', 'TRUST_PROXY', 'pass', trust && trust !== 'false' ? `Trusting ${trust === 'true' ? '1 proxy' : `${trust} proxies`}.` : 'Off (direct connections).',
      trust && trust !== 'false' ? 'Only correct when the app is reachable solely through that proxy.' : ''))
  }

  // --- Integrations ----------------------------------------------------------

  const webhooks = (facts.settings.webhook_urls ?? '').split('\n').map((line) => line.trim()).filter(Boolean)
  const webhookSecret = env.WEBHOOK_SECRET ?? ''
  if (webhooks.length && !webhookSecret) {
    checks.push(check('webhook_secret', 'Webhook secret', 'fail', `${webhooks.length} webhook URL(s) configured, WEBHOOK_SECRET not set — nothing is being sent.`,
      'Set WEBHOOK_SECRET (32+ random characters) and share it with each receiver so they can verify deliveries.'))
  } else if (webhookSecret && webhookSecret.length < 32) {
    checks.push(check('webhook_secret', 'Webhook secret', 'warn', `Set, ${webhookSecret.length} characters.`, 'Use at least 32 random characters.'))
  } else {
    checks.push(check('webhook_secret', 'Webhook secret', 'pass',
      webhooks.length ? `Set, ${webhookSecret.length} characters; ${webhooks.length} receiver(s).` : `No webhooks configured${webhookSecret ? ' (secret set)' : ''}.`))
  }

  const cronSecret = env.CRON_SECRET ?? ''
  if (!cronSecret && serverless) {
    checks.push(check('cron_secret', 'CRON_SECRET', 'warn', 'Not set on a serverless host.',
      'Without it GET /api/cron/tick is disabled, so scheduled work (announcing scheduled posts, sweeps, anything a feature schedules) waits for traffic. Set CRON_SECRET and schedule /api/cron/tick in vercel.json.'))
  } else if (cronSecret && cronSecret.length < 16) {
    checks.push(check('cron_secret', 'CRON_SECRET', 'warn', `Set, ${cronSecret.length} characters.`, 'Use at least 16 random characters.'))
  } else {
    checks.push(check('cron_secret', 'CRON_SECRET', 'pass', cronSecret ? `Set, ${cronSecret.length} characters.` : 'Not set (a long-running server runs its own interval).'))
  }

  checks.push(production && env.DISABLE_REGISTRATION !== 'true'
    ? check('registration', 'Registration', 'warn', 'Open — anyone can create an account.',
      'Set DISABLE_REGISTRATION=true and invite people from Users instead, unless open sign-up is the intent.')
    : check('registration', 'Registration', 'pass', env.DISABLE_REGISTRATION === 'true' ? 'Disabled; accounts are by invitation.' : 'Open (fine outside production).'))

  checks.push(facts.settings.public_api === 'true'
    ? check('public_api', 'Public content API', 'pass', 'On — /api/v1 answers without a token.', 'Intended for a public site. Drafts and private content are never served either way.')
    : check('public_api', 'Public content API', 'pass', 'Off — /api/v1 needs an API token or a session.', 'Turn it on in Settings if a browser-side front end reads the API directly.'))

  // --- Jobs ------------------------------------------------------------------

  const publish = facts.heartbeats.publish_due
  if (facts.dueUnannounced > 0 && (!publish || now.getTime() - new Date(publish.last_run_at).getTime() > 15 * 60_000)) {
    checks.push(check('publish_due', 'Scheduled publishing', 'warn',
      `${facts.dueUnannounced} scheduled post(s) are live but not yet announced; last check ${publish ? ago(publish.last_run_at, now) : 'never'}.`,
      'Webhooks and newsletters for them have not fired. Point a cron at GET /api/cron/publish-due with CRON_SECRET, or read /api/v1/posts once.'))
  } else {
    checks.push(check('publish_due', 'Scheduled publishing', 'pass',
      publish ? `Last checked ${ago(publish.last_run_at, now)}.` : 'No run recorded yet; nothing is waiting.'))
  }

  const backup = facts.heartbeats.backup
  if (!backup) {
    checks.push(check('backup', 'Backups', 'warn', 'No backup recorded by `npm run backup`.',
      'Schedule `npm run backup -- --gzip --s3 --keep 14` (docs/backup.md). If you rely on your database host\'s point-in-time recovery instead, this can be ignored.'))
  } else {
    const old = now.getTime() - new Date(backup.last_run_at).getTime() > 8 * DAY
    checks.push(check('backup', 'Backups', old ? 'warn' : 'pass', `Last backup ${ago(backup.last_run_at, now)}.`,
      old ? 'Backups seem to have stopped. Check the job that runs `npm run backup`.' : ''))
  }

  if (facts.rateLimitRows === null) {
    checks.push(check('rate_limits', 'Rate-limit table', 'warn', 'Could not be read.', 'Run migrations.'))
  } else {
    checks.push(facts.rateLimitRows > 50_000
      ? check('rate_limits', 'Rate-limit table', 'warn', `${facts.rateLimitRows.toLocaleString('en')} rows.`,
        'Stale entries are not being swept. Call GET /api/cron/tick from a cron (with CRON_SECRET).')
      : check('rate_limits', 'Rate-limit table', 'pass', `${facts.rateLimitRows.toLocaleString('en')} rows.`))
  }


  checks.push(facts.adminsWithout2fa > 0
    ? check('admin_2fa', 'Admin two-factor', 'warn', `${facts.adminsWithout2fa} of ${facts.adminsTotal} admin account(s) have no authenticator app set up.`,
      'Ask each admin to enable two-factor on their Profile. An admin account can export every user\'s address.')
    : check('admin_2fa', 'Admin two-factor', 'pass', `All ${facts.adminsTotal} admin account(s) use two-factor.`))

  return checks
}

/** The worst status in a list: what the page's banner shows. */
export function overallStatus(checks: HealthCheck[]): HealthStatus {
  if (checks.some((c) => c.status === 'fail')) return 'fail'
  if (checks.some((c) => c.status === 'warn')) return 'warn'
  return 'pass'
}

/**
 * Migration names in the migrator's directories, as it names them: the
 * config's `migrations` list (defineSite sets the CMS's, then the site's), or
 * one directory. Null when none can be read, which is a deployment that does
 * not ship them; a missing site directory alongside the CMS's is just empty.
 */
export function migrationFilesIn(dirs: string | string[]): string[] | null {
  let found = false
  const names: string[] = []
  for (const dir of Array.isArray(dirs) ? dirs : [dirs]) {
    try {
      names.push(
        ...readdirSync(resolve(process.cwd(), dir))
          .filter((name) => /\.(m?[jt]s)$/.test(name) && !/\.(test|spec)\.(m?[jt]s)$/.test(name))
          .map((name) => name.replace(/\.(m?[jt]s)$/, ''))
      )
      found = true
    } catch {
      // Not shipped, or a site with none of its own.
    }
  }
  return found ? names.sort() : null
}

interface FactsDb {
  driver?: string
  get: (sql: string, params?: unknown[]) => any
  all: (sql: string, params?: unknown[]) => any
}

const count = async (db: FactsDb, sql: string, params: unknown[] = []): Promise<number | null> => {
  try {
    const row = await db.get(sql, params)
    return Number(row?.n ?? 0)
  } catch {
    return null
  }
}

/**
 * The database-side facts. Every query tolerates a missing table — a health
 * page that 500s on an unmigrated database is no help diagnosing one.
 */
export async function databaseFacts(db: FactsDb, now: Date = new Date()) {
  let migrationsRan: string[] = []
  try {
    migrationsRan = ((await db.all('SELECT migration FROM _migrations')) as Array<{ migration: string }>).map((row) => row.migration)
  } catch {
    migrationsRan = []
  }

  let settings: Record<string, string> = {}
  try {
    const rows = (await db.all("SELECT key, value FROM settings WHERE key IN ('public_api', 'webhook_urls')")) as Array<{ key: string; value: string }>
    settings = Object.fromEntries(rows.map((row) => [row.key, row.value ?? '']))
  } catch {
    settings = {}
  }

  const activeAdmin = "role = 'admin' AND disabled_at IS NULL"

  return {
    migrationsRan,
    settings,
    rateLimitRows: await count(db, 'SELECT COUNT(*) AS n FROM rate_limits'),
    adminsTotal: (await count(db, `SELECT COUNT(*) AS n FROM users WHERE ${activeAdmin}`)) ?? 0,
    adminsWithout2fa: (await count(db,
      `SELECT COUNT(*) AS n FROM users WHERE ${activeAdmin}
       AND id NOT IN (SELECT user_id FROM user_two_factor WHERE totp_enabled_at IS NOT NULL)`)) ?? 0,
  }
}
