/**
 * The site template's two Vercel files, and what their functions carry.
 *
 * Vercel ships a function with only the files its tracer can reach from
 * `api/index.js` by following imports. Files read at runtime are not reached:
 *
 * - The package's `db/migrations/` and `mail/`: config.ts and the mail helper
 *   name the directories with `new URL(…, import.meta.url)` and read them with
 *   readdir and readFile. Named explicitly from node_modules rather than
 *   trusting the tracer with a directory. Without them Site health has no
 *   migration files to compare, and every mail fails to render.
 * - `basicben.config.js`: core's loadConfig finds it with existsSync and
 *   imports a computed URL. Left out, the app runs on defaults: no features,
 *   no CORS allowlist, console mail. Nothing errors.
 * - `mail/` and `db/migrations/`: the site's overrides and its own migrations.
 *
 * So both files name all of them in `includeFiles`.
 *
 * - `vercel.json` (the theme on): every path the SPA does not own goes to the
 *   function, so the theme's /:slug pages are served. The theme answers the
 *   rest with the app shell, read from dist/client/index.html, so that ships
 *   with the function too.
 *
 *   Vercel serves a static file before it applies any rewrite, and an
 *   index.html at the root of the output answers `/`. Left there, the home
 *   page was the SPA and never the theme's. So the build copies dist/client to
 *   dist/vercel-static with the shell renamed to app.html, that is the output,
 *   and the SPA's own paths are rewritten to /app.html. `/` reaches the
 *   function, which renders the theme's home, or serves the shell when the
 *   theme is off.
 * - `vercel.headless.json`: only the API, feeds, sitemap, robots and oEmbed
 *   reach the function, and everything else gets the SPA.
 *
 * Both cache /assets/ for a year: Vite names those files after their content,
 * and Vercel otherwise serves them with max-age=0, so every load re-checked
 * each one. HTML keeps Vercel's default, revalidated, so a deploy shows at once.
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
  test(`${name}: built assets are cached for a year, and nothing else is`, () => {
    const cacheRules = (vercel.headers || []).filter((rule) => rule.headers.some((h) => h.key.toLowerCase() === 'cache-control'))
    assert.deepEqual(cacheRules.map((rule) => rule.source), ['/assets/(.*)'])
    const value = cacheRules[0].headers.find((h) => h.key.toLowerCase() === 'cache-control').value
    assert.equal(value, 'public, max-age=31536000, immutable')
  })

  test(`${name}: the function carries the site's and the package's config, mail and migrations`, () => {
    const include = vercel.functions?.['api/index.js']?.includeFiles
    assert.ok(include, `${name} must set functions["api/index.js"].includeFiles`)
    for (const entry of [
      'basicben.config.js',
      'mail/**',
      'db/migrations/**',
      'node_modules/@basicbenframework/cms/mail/**',
      'node_modules/@basicbenframework/cms/db/migrations/**'
    ]) {
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

test("the theme variant's static output has no index.html, so / reaches the function", () => {
  const [, vercel] = variants[0]
  const out = vercel.outputDirectory
  assert.notStrictEqual(out, 'dist/client', 'dist/client holds index.html, which Vercel would serve for /')
  const steps = vercel.buildCommand.split('&&').map((step) => step.trim())
  assert.strictEqual(steps[0], 'npm run build')
  assert.ok(steps.includes(`cp -R dist/client ${out}`), `the build must copy dist/client to ${out}`)
  assert.ok(steps.includes(`mv ${out}/index.html ${out}/app.html`), 'the build must move the shell off the root')

  // Every rewrite to a static file names the renamed shell.
  const toStatic = vercel.rewrites.filter((r) => !r.destination.startsWith('/api/'))
  assert.ok(toStatic.length > 0)
  for (const rewrite of toStatic) assert.strictEqual(rewrite.destination, '/app.html')
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

test("the CMS's migrations are JavaScript", async () => {
  // A site runs them from node_modules, where Node will not strip types: a
  // .ts migration in the package fails every site's \`basicben migrate\`.
  const { readdirSync } = await import('node:fs')
  const files = readdirSync(join(ROOT, 'db/migrations'))
  assert.deepStrictEqual(files.filter((name) => !name.endsWith('.js')), [])
})
