import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { getDb } from '@basicbenframework/core/db'
import { loadConfig } from '@basicbenframework/core/server'
import { getStorage, resolveConfig } from '@basicbenframework/core/storage'
import { sendMail } from '@basicbenframework/core/mail'
import { Post } from '../models/Post.ts'
import { User } from '../models/User.ts'
import { featureHealthChecks } from '../host/index.ts'
import { runCron, cronAuthorized } from '../host/cron.ts'
import { readHeartbeats } from '../helpers/heartbeat.ts'
import { evaluateHealth, overallStatus, databaseFacts, migrationFilesIn, isServerless, type HealthFacts } from '../helpers/health.ts'
import type { Request, Response } from '../types/index.ts'

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

    // Features' own checks. One that throws reports itself as a warning rather
    // than taking the page down.
    for (const { name, run } of featureHealthChecks()) {
      try {
        const found = await run({ db, now, env: process.env })
        if (found) checks.push(...(Array.isArray(found) ? found : [found]))
      } catch (err) {
        checks.push({ id: name, label: name, status: 'warn', message: `The check failed: ${short(err)}`, hint: '' })
      }
    }

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
   * `GET /api/cron/maintenance`: kept as an alias of `/api/cron/tick`, which
   * runs the rate-limit sweep and every feature's scheduled work.
   */
  async maintenance(req: Request, res: Response) {
    if (!cronAuthorized(req)) return res.json({ error: 'Not found' }, 404)
    res.json(await runCron())
  }
}
