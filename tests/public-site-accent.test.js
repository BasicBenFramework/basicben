/**
 * `/api/v1/site` carries the accent colour, so a separate front end can use
 * the same brand colour as the CMS's own screens.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const load = (path) => import(pathToFileURL(join(ROOT, path)).href)

const scratch = mkdtempSync(join(tmpdir(), 'basicben-site-accent-'))
process.env.DATABASE_URL = join(scratch, 'test.sqlite')
process.env.APP_KEY = 'site-accent-test-key-that-is-long-enough-to-sign'

let db, SettingsController

before(async () => {
  const { createMigrator } = await load('node_modules/@basicbenframework/core/src/db/migrator.js')
  await (await createMigrator()).migrate()
  db = await (await import('@basicbenframework/core/db')).getDb()
  ;({ SettingsController } = await load('src/controllers/SettingsController.ts'))
})

after(() => rmSync(scratch, { recursive: true, force: true }))

const call = async (handler) => {
  const res = { json(data, status = 200) { this.body = data; this.status = status } }
  await SettingsController[handler]({ query: {}, headers: {}, params: {} }, res)
  return res.body
}

test('null until one is set, then the colour, on both site endpoints', async () => {
  assert.equal((await call('publicSite')).data.accent_color, null)
  assert.equal((await call('getSiteInfo')).accent_color, null)

  await db.run("INSERT INTO settings (key, value) VALUES ('accent_color', '#4f46e5')")
  assert.equal((await call('publicSite')).data.accent_color, '#4f46e5')
  assert.equal((await call('getSiteInfo')).accent_color, '#4f46e5')
})
