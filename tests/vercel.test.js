/**
 * The site template's two Vercel files, and what their functions carry.
 *
 * Vercel ships a function with only the files its tracer can reach from
 * `api/index.js` by following imports. The CMS's own files are reached: the
 * server entry imports config.ts and the mail helper, which point at the
 * package's db/migrations and mail/ with `new URL(…, import.meta.url)`, a
 * form the tracer follows. The site's are not:
 *
 * - `basicben.config.js`: core's loadConfig finds it with existsSync and
 *   imports a computed URL. Left out, the app runs on defaults: no features,
 *   no CORS allowlist, console mail. Nothing errors.
 * - `mail/` and `db/migrations/`: the site's overrides and its own migrations.
 *
 * So both files name them in `includeFiles`.
 *
 * - `vercel.json` (the theme on): every path the SPA does not own goes to the
 *   function, so the theme's /:slug pages are served. The theme answers the
 *   rest with the app shell, read from dist/client/index.html, so that ships
 *   with the function too.
 * - `vercel.headless.json`: only the API, feeds, sitemap, robots and oEmbed
 *   reach the function, and everything else gets the SPA.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const SITE = join(ROOT, 'site')
const read = (path) => readFileSync(join(ROOT, path), 'utf-8')
const variants = ['vercel.json', 'vercel.headless.json'].map((name) => [name, JSON.parse(readFileSync(join(SITE, name), 'utf-8'))])

for (const [name, vercel] of variants) {
  test(`${name}: the function carries the site's config, mail and migrations`, () => {
    const include = vercel.functions?.['api/index.js']?.includeFiles
    assert.ok(include, `${name} must set functions["api/index.js"].includeFiles`)
    for (const entry of ['basicben.config.js', 'mail/**', 'db/migrations/**']) {
      assert.ok(include.includes(entry), `includeFiles must name ${entry}`)
    }
    assert.ok(existsSync(join(SITE, 'basicben.config.js')))
    for (const fn of Object.keys(vercel.functions)) assert.ok(existsSync(join(SITE, fn)), `${fn} must exist`)
  })
}

test('the theme variant serves everything the SPA does not own, and ships the shell', async () => {
  const [, vercel] = variants[0]
  assert.match(vercel.functions['api/index.js'].includeFiles, /dist\/client\/index\.html/)
  assert.deepStrictEqual(vercel.rewrites.at(-1), { source: '/(.*)', destination: '/api/index' })

  // The SPA's segments go straight to the shell, and they are the theme's list.
  const theme = read('src/features/theme/ThemeController.ts')
  const segments = [...theme.match(/const SPA_SEGMENTS = new Set\(\[([^\]]*)\]/)[1].matchAll(/'([\w-]+)'/g)].map((m) => m[1])
  const routed = vercel.rewrites[0].source.match(/\(([^)]*)\)/)[1].split('|')
  assert.deepStrictEqual(routed.sort(), segments.sort())
})

test('the headless variant sends only the API and its documents to the function', () => {
  const [, vercel] = variants[1]
  assert.deepStrictEqual(vercel.rewrites.at(-1), { source: '/(.*)', destination: '/index.html' })
  assert.ok(vercel.rewrites.some((r) => r.source === '/api/(.*)'))
})

test("the server's imports lead the tracer to the CMS's migrations and mail", () => {
  assert.match(read('src/server/index.ts'), /^import '\.\.\/config\.ts'$/m)
  assert.match(read('src/config.ts'), /new URL\('\.\.\/db\/migrations\/', import\.meta\.url\)/)
  assert.match(read('src/helpers/mail-templates.ts'), /new URL\('\.\.\/\.\.\/mail\/', import\.meta\.url\)/)
})
