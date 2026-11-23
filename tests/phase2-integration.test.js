import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf-8')

test('every address-keyed limiter keys into its own namespace', () => {
  // They share one store. On the bare address they were one bucket, so being
  // blocked by one limiter (failed sign-ins) blocked every other.
  const src = read('src/middleware/rate-limits.ts')
  const blocks = src.split(/export const (\w+) = rateLimit\(\{/).slice(1)
  const namespaces = new Set()
  for (let i = 0; i < blocks.length; i += 2) {
    const name = blocks[i]
    const body = blocks[i + 1].split('})')[0]
    const key = body.match(/key:\s*([^\n]+)/)
    assert.ok(key, `${name} has no key, so it shares the bare-address bucket`)
    const ns = key[1].match(/addressIn\('([^']+)'\)/)?.[1] ?? key[1].match(/`([a-z-]+):/)?.[1] ?? key[1].trim()
    assert.ok(!namespaces.has(ns), `${name} reuses the "${ns}" namespace`)
    namespaces.add(ns)
  }
  assert.ok(namespaces.size >= 9)
})

test('phase 2 routes are registered and reachable from the admin', () => {
  const index = read('src/server/index.ts')
  for (const r of ['navigationRoutes', 'redirectsRoutes', 'snippetsRoutes']) {
    assert.match(index, new RegExp(`${r}\\(router\\)`))
  }
  const app = read('src/routes/App.tsx')
  for (const p of ['/admin/navigation', '/admin/redirects', '/admin/snippets']) {
    assert.ok(app.includes(`'${p}'`), `${p} has no client route`)
  }
})

test('page writes take a content:write token but delete needs a session', () => {
  const pages = read('src/routes/api/pages.ts')
  assert.match(pages, /router\.post\('\/api\/pages', authOrToken\('content:write'\)/)
  assert.match(pages, /router\.put\('\/api\/pages\/:id', authOrToken\('content:write'\)/)
  assert.match(pages, /router\.delete\('\/api\/pages\/:id', auth,/)
})
