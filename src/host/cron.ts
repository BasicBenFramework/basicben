/**
 * One cron entry point for core and every feature.
 *
 * `GET /api/cron/tick` (with `Authorization: Bearer $CRON_SECRET`, which Vercel
 * Cron sends) and, on a long-running server, an in-process interval run
 * whatever is due. A task records its last run in `ops_heartbeats` under
 * `cron:<name>`, so "due" is shared by every serverless instance and the
 * health page can see it.
 *
 * Tasks run one after another within a time budget; one that throws is
 * logged and the rest still run. A task left over when the budget runs out is
 * simply due at the next tick.
 */

import { timingSafeEqual } from 'node:crypto'
import { getDb } from '@basicbenframework/core/db'
import { recordHeartbeat, readHeartbeats } from '../helpers/heartbeat.ts'
import { cronTaskList, type CronTask } from './index.ts'
import type { Request, Response } from '../types'

export interface TickResult {
  ran: Record<string, unknown>
  skipped: string[]
  failed: Record<string, string>
}

const short = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200)

/**
 * Run the tasks that are due, or with `only`, exactly those tasks whether due
 * or not (the legacy per-job routes).
 */
export async function runCron(
  options: { only?: string[]; budgetMs?: number; now?: () => number; tasks?: CronTask[]; db?: any } = {}
): Promise<TickResult> {
  const now = options.now ?? Date.now
  const started = now()
  const budget = options.budgetMs ?? 25_000
  const db = options.db ?? ((await getDb()) as any)
  const beats = await readHeartbeats(db)
  const result: TickResult = { ran: {}, skipped: [], failed: {} }

  const tasks = (options.tasks ?? cronTaskList()).filter((task) => !options.only || options.only.includes(task.name))

  for (const task of tasks) {
    if (now() - started > budget) {
      result.skipped.push(task.name)
      continue
    }

    if (!options.only) {
      const last = beats[`cron:${task.name}`]?.last_run_at
      if (last && now() - Date.parse(last) < task.everySeconds * 1000) continue
    }

    try {
      result.ran[task.name] = (await task.run()) ?? true
      await recordHeartbeat(db, `cron:${task.name}`, { ok: true }, new Date(now()))
    } catch (err) {
      result.failed[task.name] = short(err)
      console.error(`[cron] ${task.name}: ${short(err)}`)
      // Recorded as run, so a task that always fails does not run on every
      // tick; the detail says why, for the health page.
      await recordHeartbeat(db, `cron:${task.name}`, { ok: false, error: short(err) }, new Date(now()))
    }
  }

  return result
}

/** Whether the request carries CRON_SECRET. With none configured, cron routes are disabled. */
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  const given = String(req.headers.authorization ?? '')
  const expected = `Bearer ${secret}`
  return Boolean(secret) && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected))
}

/** `GET /api/cron/tick`. 404 without the secret, so it does not advertise itself. */
export async function cronTickEndpoint(req: Request, res: Response) {
  if (!cronAuthorized(req)) return res.json({ error: 'Not found' }, 404)
  res.json(await runCron())
}

/** A legacy per-job route: runs the named tasks now, whether due or not. */
export function cronAliasEndpoint(names: string[]) {
  return async (req: Request, res: Response) => {
    if (!cronAuthorized(req)) return res.json({ error: 'Not found' }, 404)
    res.json(await runCron({ only: names }))
  }
}

let interval: ReturnType<typeof setInterval> | null = null

/** The in-process tick, for a long-running server. Not on serverless, where nothing outlives the request. */
export function startCronInterval(everyMs = 60_000): void {
  if (interval || process.env.VERCEL) return
  const tick = () => runCron().catch((err) => console.error('[cron]', short(err)))
  interval = setInterval(tick, everyMs)
  interval.unref?.()
  void tick()
}
