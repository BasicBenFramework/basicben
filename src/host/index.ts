/**
 * The feature host: how a feature in `src/features/` plugs into the core.
 *
 * A feature is a folder and one line in `src/features.ts`. It imports core
 * modules directly; this file only offers the registries a feature cannot do
 * without — the places it would otherwise have had to edit a core file. Each
 * one exists because a feature needed it, and nothing is added on speculation.
 *
 * Internal API: it may change in any release. See
 * basicben-framework/plans/2026-11-23-phase-4-extensions.md.
 */

import { hooks } from '@basicbenframework/core/hooks'
import { defineSettings, type SettingDefinition } from '../helpers/site-settings.ts'
import type { HealthCheck } from '../helpers/health.ts'
import { setAccessPolicy, type AccessPolicy, type Viewer } from '../helpers/access.ts'

/** The router as route files see it. */
export interface Router {
  get: (path: string, ...handlers: Function[]) => void
  post: (path: string, ...handlers: Function[]) => void
  put: (path: string, ...handlers: Function[]) => void
  patch: (path: string, ...handlers: Function[]) => void
  delete: (path: string, ...handlers: Function[]) => void
}

/** What a health check is given. Every query should tolerate a missing table. */
export interface HealthContext {
  db: any
  now: Date
  env: Record<string, string | undefined>
}

export type HealthCheckFn = (context: HealthContext) => Promise<HealthCheck | HealthCheck[] | null>

export interface CronTask {
  name: string
  /** At most this often. The tick runs every minute on a long-running server; on serverless, as often as the platform's cron calls it. */
  everySeconds: number
  run: () => Promise<unknown>
}

export interface Host {
  hooks: typeof hooks
  /** Routes, mounted after core's and in feature-list order. */
  routes(register: (router: Router) => void): void
  settings: {
    /** Open the settings allowlist for this feature's keys. Validators: `checks` in helpers/site-settings. */
    define(definitions: Record<string, SettingDefinition>): void
  }
  cron: {
    /** Run `run` at most every `everySeconds`, from GET /api/cron/tick and the in-process interval. */
    task(name: string, everySeconds: number, run: () => Promise<unknown>): void
  }
  health: {
    /** Add to the site-health page. Return null to add nothing. */
    check(name: string, run: HealthCheckFn): void
  }
  access: {
    /** Become the site's one access policy (helpers/access.ts). A second registration throws. */
    policy<V extends Viewer>(policy: AccessPolicy<V>): void
  }
}

export interface Feature {
  name: string
  register(host: Host): void | Promise<void>
}

const routeRegistrations: Array<{ feature: string; register: (router: Router) => void }> = []
const cronTasks = new Map<string, CronTask>()
const healthChecks: Array<{ name: string; run: HealthCheckFn }> = []
const registered = new Set<string>()

/** Core's own cron tasks go through the same registry. */
export function addCronTask(task: CronTask): void {
  if (cronTasks.has(task.name)) throw new Error(`Cron task "${task.name}" is already registered`)
  if (!(task.everySeconds > 0)) throw new Error(`Cron task "${task.name}" needs a positive interval`)
  cronTasks.set(task.name, task)
}

export function cronTaskList(): CronTask[] {
  return [...cronTasks.values()]
}

export function featureHealthChecks(): Array<{ name: string; run: HealthCheckFn }> {
  return [...healthChecks]
}

function hostFor(feature: string): Host {
  return {
    hooks,
    routes(register) {
      routeRegistrations.push({ feature, register })
    },
    settings: {
      define(definitions) {
        defineSettings(definitions)
      }
    },
    cron: {
      task(name, everySeconds, run) {
        addCronTask({ name: `${feature}:${name}`, everySeconds, run })
      }
    },
    health: {
      check(name, run) {
        healthChecks.push({ name: `${feature}:${name}`, run })
      }
    },
    access: {
      policy(policy) {
        setAccessPolicy(policy)
      }
    }
  }
}

/**
 * Register every feature in the list, in order. Called once by the server
 * entry before routes are mounted. A feature listed twice is refused: its
 * settings and tasks would collide anyway, with a worse message.
 */
export async function registerFeatures(features: Feature[]): Promise<void> {
  for (const feature of features) {
    if (registered.has(feature.name)) throw new Error(`Feature "${feature.name}" is listed twice`)
    registered.add(feature.name)
    await feature.register(hostFor(feature.name))
  }
}

/** Mount every feature's routes. After core's routes, in feature-list order. */
export function mountFeatureRoutes(router: Router): void {
  for (const { register } of routeRegistrations) register(router)
}

export function registeredFeatures(): string[] {
  return [...registered]
}
