/**
 * The admin is translatable, and what each language does translate is right.
 *
 * Strings are keyed on their English text (src/client/i18n), so the checks
 * here are about the source: a translation must keep the English
 * `{placeholders}`, and the admin's files must not carry visible English that
 * bypasses `t()` altogether.
 *
 * A language may be incomplete: `t()` shows the English for a string it lacks,
 * so a new language can ship partly done and fill in over time, and a new
 * admin string does not have to be translated into every language before it
 * merges. What is missing is reported as a test note; run with
 * `I18N_STRICT=1` to fail on it instead (to finish a language, or before a
 * release you want complete).
 *
 * The hard-coded-text check is a heuristic over JSX — text between tags and
 * the human-readable attributes — not a parser. It is strict on purpose: a
 * false positive costs wrapping one more string, a false negative is a screen
 * half in English. Product names and symbols are allowed through `IGNORED`.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf-8')

/** The files that make up the admin. Public pages and the framework docs pages are not admin. */
export function adminFiles() {
  const dirs = ['src/client/pages/admin', 'src/client/components/admin']
  const files = ['src/client/layouts/AdminLayout.tsx', 'src/client/pages/Profile.tsx', 'src/client/hooks/usePostLock.ts', 'src/client/hooks/useMediaLibrary.ts', 'src/client/hooks/useContentTypes.ts', 'src/client/components/MarkdownEditor.tsx']

  for (const dir of dirs) {
    for (const entry of readdirSync(join(ROOT, dir))) {
      if (entry.endsWith('.tsx') || entry.endsWith('.ts')) files.push(`${dir}/${entry}`)
    }
  }

  // Each feature's admin half. Its strings may live in its own dictionary.
  for (const feature of featureDirs()) {
    for (const entry of readdirSync(join(ROOT, 'src/features', feature))) {
      if (/\.tsx?$/.test(entry) && entry !== 'index.ts' && entry !== 'manifest.ts') files.push(`src/features/${feature}/${entry}`)
    }
  }

  return files.filter((file) => existsSync(join(ROOT, file)))
}

/** The feature folders in the tree, enabled or not. */
export function featureDirs() {
  const dir = join(ROOT, 'src/features')
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : []
}

/** A JS string literal's value, for the three quote styles (template literals without `${}` only). */
function unquote(literal) {
  const quote = literal[0]
  const body = literal.slice(1, -1)
  if (quote === '`') return body.includes('${') ? null : body
  return body.replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n')
}

const STRING = String.raw`('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|` + '`[^`]*`)'

/** Every key the admin asks a dictionary for. */
export function usedKeys() {
  const keys = new Map()
  const plural = new RegExp(String.raw`\btn\(\s*` + STRING + String.raw`\s*,\s*` + STRING, 'g')
  const single = new RegExp(String.raw`(?<![\w.])t\(\s*` + STRING, 'g')

  for (const file of adminFiles()) {
    const source = read(file)

    for (const match of source.matchAll(plural)) {
      const one = unquote(match[1])
      const other = unquote(match[2])
      if (one !== null && other !== null) keys.set(`${one}|${other}`, { file, plural: true, one, other })
    }

    for (const match of source.matchAll(single)) {
      const value = unquote(match[1])
      if (value !== null && !keys.has(value)) keys.set(value, { file, plural: false })
    }
  }

  // The menu labels and section names come from the server as English and are
  // translated with t(item.label), so the dictionary needs them too.
  const layout = read('src/client/layouts/AdminLayout.tsx')
  const start = layout.indexOf('= [', layout.indexOf('const CORE_MENU'))
  const menu = layout.slice(start, layout.indexOf(']', start))
  for (const match of menu.matchAll(/(?:label|section): '([^']+)'/g)) keys.set(match[1], { file: 'AdminLayout CORE_MENU', plural: false })

  // And a feature's page label and section, from its manifest.
  for (const feature of featureDirs()) {
    const path = `src/features/${feature}/manifest.ts`
    if (!existsSync(join(ROOT, path))) continue
    const pages = read(path)
    for (const match of pages.matchAll(/(?:label|section): '([^']+)'/g)) keys.set(match[1], { file: path, plural: false })
  }

  return keys
}

const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')

/** Locales other than English, read from the i18n module's own list. */
function shippedLocales() {
  const source = read('src/client/i18n/index.ts')
  return [...source.matchAll(/\{ code: '([\w-]+)'/g)].map((m) => m[1]).filter((code) => code !== 'en')
}

describe('admin translations', () => {
  test('the admin asks for translations at all', () => {
    assert.ok(usedKeys().size > 300, `only ${usedKeys().size} translatable strings found`)
    assert.ok(usedKeys().has('Posts') && usedKeys().has('Account'), 'the menu labels were not found')
  })

  for (const code of shippedLocales()) {
    test(`${code} keeps every placeholder, and lists what it has not translated`, async (t) => {
      const path = join(ROOT, `src/client/i18n/locales/${code}/index.ts`)
      assert.ok(existsSync(path), `no dictionary at src/client/i18n/locales/${code}/index.ts`)
      // Core's dictionary with every feature's merged over it, as setLocale does.
      const dictionary = { ...(await import(pathToFileURL(path).href)).default }
      for (const feature of featureDirs()) {
        const own = join(ROOT, `src/features/${feature}/i18n/${code}.ts`)
        if (existsSync(own)) Object.assign(dictionary, (await import(pathToFileURL(own).href)).default)
      }

      const missing = []
      const mismatched = []

      for (const [key, info] of usedKeys()) {
        const entry = dictionary[key]

        if (info.plural) {
          if (!entry || typeof entry !== 'object' || !entry.other) { missing.push(`${key}  (${info.file})`); continue }
          for (const form of Object.values(entry)) {
            if (placeholders(form) !== placeholders(info.other)) mismatched.push(key)
          }
        } else {
          if (typeof entry !== 'string' || !entry) { missing.push(`${key}  (${info.file})`); continue }
          if (placeholders(entry) !== placeholders(key)) mismatched.push(key)
        }
      }

      // A wrong placeholder breaks the sentence on screen; a missing one is English.
      assert.deepStrictEqual(mismatched, [], `placeholders differ in ${code}`)

      if (missing.length) {
        const total = usedKeys().size
        const note = `${code}: ${missing.length} of ${total} strings not translated yet (shown in English)`
        if (process.env.I18N_STRICT) assert.deepStrictEqual(missing, [], note)
        t.diagnostic(note)
        for (const line of missing.slice(0, 20)) t.diagnostic(`  ${line}`)
        if (missing.length > 20) t.diagnostic(`  … and ${missing.length - 20} more (I18N_STRICT=1 lists them all)`)
      }
    })
  }
})

// Text that is the same in every language.
const IGNORED = new Set(['BasicBen', 'B', 'URL', 'API', 'RSS', 'JSON', 'HTML', 'CSV', 'S3', 'SMTP', 'OK', 'ID', 'oEmbed', 'Markdown', 'TOTP', 'https://', 'robots.txt'])

function stripComments(source) {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

describe('no untranslated text in the admin', () => {
  for (const file of adminFiles().filter((f) => f.endsWith('.tsx') && !f.endsWith('AdminIcons.tsx'))) {
    test(file, () => {
      // Styles are template strings of CSS, not text.
      const source = stripComments(read(file))
        .replace(/const \w*[sS]tyles = `[\s\S]*?`/g, '')
        // Code samples are the same in every language.
        .replace(/<code>[\s\S]*?<\/code>/g, '<code></code>')
        // TypeScript generics (`api.get<{ … }>(`, `Promise<boolean>`) look like
        // tags to a regex; nothing between an identifier and `<` is JSX text.
        .replace(/(\w)<(?=[\w{[(])/g, '$1 ‹')
      const found = []

      // Text between tags: `>Save changes<`, `>Delete {name}?<` style fragments.
      for (const match of source.matchAll(/>([^<>{}]*[A-Za-z]{2}[^<>{}]*)</g)) {
        const text = match[1].trim()
        if (!text || IGNORED.has(text) || /^[\s\W\d]*$/.test(text)) continue
        // Generic type arguments and arrow functions look like tags to a regex.
        if (/=>|\)\s*$|^\s*[,;)]|&&|\|\||[=(]/.test(text)) continue
        // Statements between two JSX expressions (`</>\n case 'x': return <`).
        if (/\b(return|case|default:)\b/.test(text)) continue
        found.push(text)
      }

      // Human-readable attributes with a literal value.
      for (const match of source.matchAll(/\b(placeholder|title|aria-label|alt|label)="([^"]*[A-Za-z]{2}[^"]*)"/g)) {
        if (IGNORED.has(match[2])) continue
        found.push(`${match[1]}="${match[2]}"`)
      }

      assert.deepStrictEqual(found, [], `untranslated text in ${file}`)
    })
  }
})
