import { randomUUID, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { getDb } from '@basicbenframework/core/db'
import { loadConfig } from '@basicbenframework/core/server'
import { getStorage, resolveConfig } from '@basicbenframework/core/storage'
import { sendMail } from '@basicbenframework/core/mail'
import { Post } from '../models/Post'
import { User } from '../models/User'
import { purge } from '../models/Analytics'
import { readHeartbeats } from '../helpers/heartbeat'
import { evaluateHealth, overallStatus, databaseFacts, migrationFilesIn, isServerless, type HealthFacts } from '../helpers/health'
import type { Request, Response } from '../types'

/**
 * The installed framework version, read from its package.json.
 *
 * Not through a package export — the framework exports no `package.json` —
 * but beside the module the runtime resolved, so it reports what is actually
 * loaded rather than what package.json asked for.
 */
async function frameworkVersion(): Promise<string | null> {
  try {
    const entry = import.meta.resolve('@basicbenframework/core')
    const pkg = JSON.parse(await readFile(new URL('../package.json', entry), 'utf-8'))
    return typeof pkg.version === 'string' ? pkg.version : null
  } catch {
    return null
  }
}

/** The configured mail transport's name. A function transport is "custom". */
function transportName(mail: any): string {
  if (!mail) return 'console'
  if (typeof mail.transport === 'function') return 'custom'
  return String(mail.transport || 'console')
}

/** An error message safe to show: short, and never a stack. */
const short = (err: unknown) => String((err as Error)?.message ?? err).slice(0, 300)

/**
 * Site health (admin only) and the maintenance cron.
 */
export const HealthController = {
  /** `GET /api/admin/health` */
  async index(_req: Request, res: Response) {
    const db = (await getDb()) as any
    const config = (await loadConfig()) as any
    const now = new Date()

    let dueUnannounced = 0
    try {
      dueUnannounced = (await Post.dueForNotification()).length
    } catch {
      dueUnannounced = 0
    }

    const facts: HealthFacts = {
      nodeVersion: process.versions.node,
      frameworkVersion: await frameworkVersion(),
      dbDriver: String(db.driver ?? 'sqlite'),
      migrationFiles: migrationFilesIn('db/migrations'),
      storageDriver: String(resolveConfig(config.storage || {}).driver),
      mailTransport: transportName(config.mail),
      mailFrom: config.mail?.from ?? null,
      heartbeats: await readHeartbeats(db),
      dueUnannounced,
      ...(await databaseFacts(db, now))
    }

    const checks = evaluateHealth(process.env, facts, now)

    res.setHeader('Cache-Control', 'no-store')
    res.json({
      status: overallStatus(checks),
      generated_at: now.toISOString(),
      environment: {
        node_env: process.env.NODE_ENV || null,
        serverless: isServerless(process.env)
      },
      checks
    })
  },

  /**
   * `POST /api/admin/health/storage-probe` — write, read back and delete a
   * small object. Behind a button, not run on page load, because it is a
   * write to the production bucket.
   */
  async storageProbe(_req: Request, res: Response) {
    const steps: Array<{ step: string; ok: boolean; ms: number; error?: string }> = []
    const key = `health-probe/${randomUUID()}.txt`
    const body = `basicben storage probe ${new Date().toISOString()}`

    let storage: any
    try {
      storage = await getStorage()
    } catch (err) {
      return res.json({ ok: false, driver: null, steps: [{ step: 'configure', ok: false, ms: 0, error: short(err) }] })
    }

    const run = async (step: string, fn: () => Promise<void>) => {
      const started = Date.now()
      try {
        await fn()
        steps.push({ step, ok: true, ms: Date.now() - started })
        return true
      } catch (err) {
        steps.push({ step, ok: false, ms: Date.now() - started, error: short(err) })
        return false
      }
    }

    const wrote = await run('write', async () => {
      await storage.put(key, body, { contentType: 'text/plain' })
    })

    if (wrote) {
      await run('read', async () => {
        const got = await storage.get(key)
        const text = Buffer.isBuffer(got?.body) ? got.body.toString('utf-8') : String(got?.body ?? got ?? '')
        if (text !== body) throw new Error('Read back different content than was written')
      })
      // Always attempted once something was written, so a failed read does
      // not leave the probe object behind.
      await run('delete', async () => {
        await storage.delete(key)
      })
    }

    res.json({ ok: steps.every((s) => s.ok), driver: storage.driver ?? null, steps })
  },

  /** `POST /api/admin/health/test-email` — to the signed-in admin only. */
  async testEmail(req: Request, res: Response) {
    // The recipient is never taken from the request: a test button that mails
    // any address is an open relay with an admin's name on it.
    const user = await User.find(req.userId as number)
    if (!user?.email) return res.json({ error: 'Your account has no email address' }, 422)

    const config = (await loadConfig()) as any
    const transport = transportName(config.mail)

    try {
      await sendMail({
        to: user.email,
        subject: 'BasicBen test email',
        text:
          'This is a test from the Site health page.\n\n' +
          'If you are reading it, password resets, invitations and notifications can reach people too.\n'
      })
    } catch (err) {
      return res.json({ sent: false, transport, error: short(err) }, 502)
    }

    res.json({
      sent: true,
      transport,
      to: user.email,
      note: transport === 'console' ? 'The console transport printed the message to the server log; nothing was delivered.' : null
    })
  },

  /**
   * `GET /api/cron/maintenance` — the analytics purge and the rate-limit
   * sweep, for a platform scheduler. Same CRON_SECRET rule as publish-due:
   * disabled (404) until a secret is set.
   */
  async maintenance(req: Request, res: Response) {
    const secret = process.env.CRON_SECRET
    const given = String(req.headers.authorization ?? '')
    const expected = `Bearer ${secret}`

    if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
      return res.json({ error: 'Not found' }, 404)
    }

    const db = (await getDb()) as any
    const result: Record<string, unknown> = {}

    try {
      result.analytics = await purge({}, db)
    } catch (err) {
      result.analytics = { error: short(err) }
    }

    // What DatabaseStore.sweep does, inline: nothing in the app calls the
    // store's sweep, so lapsed rows otherwise stay forever. A row whose window
    // and block have both passed is the state "never seen".
    try {
      const now = Date.now()
      const swept = await db.run(
        'DELETE FROM rate_limits WHERE updated_at < ? AND (blocked_until IS NULL OR blocked_until < ?)',
        [now - 86_400_000, now]
      )
      result.rate_limits = { swept: Number(swept?.changes ?? 0) }
    } catch (err) {
      result.rate_limits = { error: short(err) }
    }

    res.json(result)
  }
}
