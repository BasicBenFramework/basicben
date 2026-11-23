/**
 * The admin is translatable, and every shipped language is complete.
 *
 * Strings are keyed on their English text (src/client/i18n), so the checks
 * here are about the source: every `t()`/`tn()` literal must have an entry in
 * every non-English dictionary with the same `{placeholders}`, and the admin's
 * files must not carry visible English that bypasses `t()` altogether.
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

  return files.filter((file) => existsSync(join(ROOT, file)))
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
  const menu = layout.slice(layout.indexOf('const DEFAULT_MENU'), layout.indexOf(']', layout.indexOf('const DEFAULT_MENU')))
  for (const match of menu.matchAll(/(?:label|section): '([^']+)'/g)) keys.set(match[1], { file: 'AdminLayout DEFAULT_MENU', plural: false })

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
  })

  for (const code of shippedLocales()) {
    test(`${code} has every string, with the same placeholders`, async () => {
      const path = join(ROOT, `src/client/i18n/locales/${code}/index.ts`)
      assert.ok(existsSync(path), `no dictionary at src/client/i18n/locales/${code}/index.ts`)
      const dictionary = (await import(pathToFileURL(path).href)).default

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

      assert.deepStrictEqual(missing, [], `${missing.length} strings missing from ${code}`)
      assert.deepStrictEqual(mismatched, [], `placeholders differ in ${code}`)
    })
  }
})

// Text that is the same in every language.
const IGNORED = new Set(['BasicBen', 'B', 'URL', 'API', 'RSS', 'JSON', 'HTML', 'CSV', 'S3', 'SMTP', 'OK', 'ID', 'oEmbed', 'Markdown', 'TOTP'])

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
      const source = stripComments(read(file)).replace(/const \w*[sS]tyles = `[\s\S]*?`/g, '')
      const found = []

      // Text between tags: `>Save changes<`, `>Delete {name}?<` style fragments.
      for (const match of source.matchAll(/>([^<>{}]*[A-Za-z]{2}[^<>{}]*)</g)) {
        const text = match[1].trim()
        if (!text || IGNORED.has(text) || /^[\s\W\d]*$/.test(text)) continue
        // Generic type arguments and arrow functions look like tags to a regex.
        if (/=>|\)\s*$|^\s*[,;)]|&&|\|\||[=(]/.test(text)) continue
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
