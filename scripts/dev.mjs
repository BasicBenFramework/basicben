/**
 * `npm run dev` in the repository: the template site in site/, running the
 * CMS from this checkout.
 *
 * The site imports the package, and the package is lib/, so the CMS's source
 * is compiled as it changes: tsc in watch mode, plus a copy of styles.css. The
 * site's own `basicben dev` then picks the change up: Vite reloads the admin,
 * and Node's --watch restarts the server when a lib/ file it imported changes.
 * `npm run build:lib` has already run once, so the site starts on a full lib/.
 */
import { spawn } from 'node:child_process'
import { copyFileSync, watch } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const STYLES = join(ROOT, 'src/client/styles.css')

const children = [
  spawn('npx', ['tsc', '-w', '--preserveWatchOutput', '-p', 'tsconfig.build.json'], { cwd: ROOT, stdio: 'inherit' }),
  spawn('npm', ['run', 'dev', '--workspace', 'site'], { cwd: ROOT, stdio: 'inherit' })
]

watch(STYLES, () => copyFileSync(STYLES, join(ROOT, 'lib/client/styles.css')))

function stop(code = 0) {
  for (const child of children) child.kill('SIGTERM')
  process.exit(code)
}

process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
for (const child of children) child.on('exit', (code) => stop(code ?? 0))
