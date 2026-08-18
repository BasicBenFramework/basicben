#!/usr/bin/env node
/**
 * Generate the consumer API reference from the source it documents.
 *
 * The Headless docs page listed the endpoints and said nothing about what came
 * back, so a consumer learned the response shape by reading
 * `src/models/PublicContent.ts`. The obvious fix — write the field tables by
 * hand — makes the docs a second declaration of the same shape, and a second
 * declaration drifts. The entry-point list on the Testing page said nineteen
 * for two releases after it became eighteen; nobody noticed, because prose
 * does not fail a build.
 *
 * So the tables are generated from the interfaces, and each field's
 * description is the JSDoc comment sitting above it. There is one place to
 * change a field, and `api-reference.test.js` fails when the checked-in output
 * stops matching what this produces.
 *
 * What is *not* derived is prose: the query-parameter descriptions and the
 * endpoint summaries live here. To stop those going stale the same way, the
 * generator asserts that every route in `v1.ts` has an entry and that every
 * query parameter the code actually reads is documented, and throws when they
 * disagree. A field added without a description is a hard failure, not a blank
 * cell.
 *
 * Usage: node scripts/generate-api-reference.js [--check] [--out <path>]
 *
 * `--out` exists because the docs pages are maintained in two copies — the
 * template shipped to new projects and the public website, a separate repo —
 * and the website's copy is plain JavaScript. The emitted module carries no
 * type annotations, so the same bytes serve both; writing the second one with
 * this rather than copying it by hand means it can be regenerated and checked
 * instead of remembered.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCOPES } from '../packages/core/src/auth/api-tokens.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TEMPLATE = join(ROOT, 'apps/cms')

const MODEL = join(TEMPLATE, 'src/models/PublicContent.ts')
const ROUTES = join(TEMPLATE, 'src/routes/api/v1.ts')
const CONTROLLER = join(TEMPLATE, 'src/controllers/PublicApiController.ts')

const OUTPUT = join(TEMPLATE, 'src/client/pages/api-reference.ts')

/** The shapes worth documenting, in the order a reader meets them. */
const SHAPES = ['PublicPost', 'PublicPage', 'PublicCategory', 'PublicTag', 'PublicMedia']

/**
 * What each controller action returns, and whether it is a collection.
 *
 * Hand-written because nothing in the source states it — the controller returns
 * `res.json(...)` and the type is inferred. Every route in `v1.ts` must appear
 * here or generation fails, so adding an endpoint without documenting it is a
 * build error rather than a silent omission.
 */
const ACTIONS = {
  posts: { shape: 'PublicPost', collection: true, summary: 'Published posts, newest first.' },
  post: { shape: 'PublicPost', collection: false, summary: 'One published post, by slug or id.' },
  pages: { shape: 'PublicPage', collection: true, summary: 'Published pages, newest first.' },
  page: { shape: 'PublicPage', collection: false, summary: 'One published page, by slug or id.' },
  categories: { shape: 'PublicCategory', collection: false, summary: 'Every category, with post counts.' },
  tags: { shape: 'PublicTag', collection: false, summary: 'Every tag, with post counts.' },
  media: { shape: 'PublicMedia', collection: false, summary: 'One media item, by id.' }
}

/**
 * Descriptions for the query parameters the code reads.
 *
 * The names are checked against the source rather than trusted: every
 * `query.x` in the controller and the model must be a key here, and every key
 * must appear in the source. A parameter added to one and not the other stops
 * the build.
 */
const PARAMS = {
  page: 'Which page of results. Defaults to 1.',
  per_page: 'Results per page. Defaults to 10, clamped to 100.',
  category: 'Filter posts by category slug or id.',
  tag: 'Filter posts by tag slug or id.',
  search: 'Filter posts whose title or excerpt contains this text.',
  format: '`markdown` returns the source. Anything else returns rendered HTML.'
}

/** Endpoints answer with this envelope; it is written once in the controller. */
const ENVELOPE = {
  item: '{ "data": <object> }',
  collection: '{ "data": [<object>], "meta": { "page", "per_page", "total", "total_pages" } }',
  error: '{ "error": "Not found" }'
}

// --- Parsing ------------------------------------------------------------------

/**
 * Fields of an exported interface, with the doc comment above each.
 *
 * Deliberately strict: anything inside the interface that is not a comment, a
 * blank line or a `name: type` field throws. A parser that skips what it does
 * not understand produces a reference that is quietly missing a field, which is
 * the exact failure this whole approach exists to prevent.
 */
function parseInterface(source, name) {
  const start = source.indexOf(`export interface ${name} {`)

  if (start === -1) throw new Error(`interface ${name} not found in ${MODEL}`)

  const open = source.indexOf('{', start)
  const close = source.indexOf('\n}', open)

  if (close === -1) throw new Error(`interface ${name} is not closed at column 0`)

  const body = source.slice(open + 1, close).split('\n')
  const fields = []

  let doc = null
  let inBlock = false
  let block = []

  for (const raw of body) {
    const line = raw.trim()

    if (!line) continue

    if (inBlock) {
      if (line.endsWith('*/')) {
        inBlock = false
        doc = block.join(' ').trim()
        block = []
      } else {
        block.push(line.replace(/^\*\s?/, ''))
      }
      continue
    }

    if (line.startsWith('/**')) {
      if (line.endsWith('*/')) {
        doc = line.slice(3, -2).trim()
      } else {
        inBlock = true
        block = [line.slice(3).trim()].filter(Boolean)
      }
      continue
    }

    const match = line.match(/^(\w+)(\??):\s*(.+?)$/)

    if (!match) throw new Error(`cannot parse "${line}" in interface ${name}`)

    const [, field, optional, type] = match

    if (!doc) throw new Error(`${name}.${field} has no doc comment — it would render as a blank cell`)

    fields.push({
      name: field,
      type: expandAliases(source, type.replace(/,$/, '').trim()),
      optional: optional === '?',
      description: doc
    })

    doc = null
  }

  if (fields.length === 0) throw new Error(`interface ${name} parsed to zero fields`)

  return fields
}

/**
 * Inline local type aliases.
 *
 * A consumer reading `format: ContentFormat` learns nothing — the name is
 * meaningful inside this codebase and opaque from outside it, where there is no
 * declaration to follow. `'html' | 'markdown'` is the answer they came for.
 */
function expandAliases(source, type) {
  let expanded = type

  for (const [, name, value] of source.matchAll(/^export type (\w+) = (.+)$/gm)) {
    expanded = expanded.replace(new RegExp(`\\b${name}\\b`, 'g'), value.trim())
  }

  return expanded
}

/** The doc comment immediately above `export interface Name`, if there is one. */
function interfaceDoc(source, name) {
  const start = source.indexOf(`export interface ${name} {`)
  const before = source.slice(0, start)
  const open = before.lastIndexOf('/**')
  const close = before.lastIndexOf('*/')

  // Only counts when the comment ends right against the declaration.
  if (open === -1 || close < open || before.slice(close + 2).trim() !== '') return ''

  return before
    .slice(open + 3, close)
    .split('\n')
    .map((line) => line.trim().replace(/^\*\s?/, ''))
    .join('\n')
    .trim()
    .split('\n\n')[0]
    .replace(/\n/g, ' ')
    .trim()
}

/** Routes as declared, with the scope each requires. */
function parseRoutes(source) {
  // `const content = requireScope(SCOPES.CONTENT_READ)` — resolved through the
  // framework's own SCOPES so a renamed scope cannot be documented under its
  // old name.
  const aliases = {}

  for (const [, alias, key] of source.matchAll(/const (\w+) = requireScope\(SCOPES\.(\w+)\)/g)) {
    if (!(key in SCOPES)) throw new Error(`v1.ts requires SCOPES.${key}, which does not exist`)
    aliases[alias] = SCOPES[key]
  }

  const routes = []

  for (const [, path, middleware, action] of source.matchAll(
    /router\.get\('([^']+)',\s*([^)]*?)PublicApiController\.(\w+)\)/g
  )) {
    const scope = Object.keys(aliases).find((alias) =>
      new RegExp(`\\b${alias}\\b`).test(middleware)
    )

    if (!scope) throw new Error(`route ${path} has no requireScope alias in its middleware`)
    if (!ACTIONS[action]) throw new Error(`route ${path} calls ${action}, which is not documented in ACTIONS`)

    routes.push({ method: 'GET', path, scope: aliases[scope], action })
  }

  if (routes.length === 0) throw new Error('no routes parsed from v1.ts')

  return routes
}

/**
 * Every documented action is actually routed.
 *
 * The reverse — a route with no entry — is caught in `parseRoutes`, per route.
 * This one is a whole-file question, so it runs against the real `v1.ts` in
 * `generate()` rather than inside the parser, which the tests feed fragments.
 */
function assertNothingDocumentedIsDead(routes) {
  const documented = Object.keys(ACTIONS).sort()
  const routed = [...new Set(routes.map((route) => route.action))].sort()

  if (documented.join() !== routed.join()) {
    throw new Error(
      `ACTIONS documents [${documented}] but v1.ts routes [${routed}] — ` +
        'an entry with no route is dead prose'
    )
  }
}

/** Query parameters the code actually reads, so the documented set can be checked. */
function readQueryParams(...sources) {
  const found = new Set()

  for (const source of sources) {
    for (const [, name] of source.matchAll(/\bquery\.(\w+)\b/g)) found.add(name)
  }

  return [...found].sort()
}

// --- Emitting -----------------------------------------------------------------

const quote = (value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

function render({ routes, shapes, params }) {
  const endpoints = routes
    .map(
      (route) =>
        `  {\n` +
        `    method: ${quote(route.method)},\n` +
        `    path: ${quote(route.path)},\n` +
        `    scope: ${quote(route.scope)},\n` +
        `    shape: ${quote(ACTIONS[route.action].shape)},\n` +
        `    collection: ${ACTIONS[route.action].collection},\n` +
        `    summary: ${quote(ACTIONS[route.action].summary)}\n` +
        `  }`
    )
    .join(',\n')

  const shapeBlocks = shapes
    .map((shape) => {
      const fields = shape.fields
        .map(
          (field) =>
            `      { name: ${quote(field.name)}, type: ${quote(field.type)}, ` +
            `description: ${quote(field.description)} }`
        )
        .join(',\n')

      return (
        `  {\n` +
        `    name: ${quote(shape.name)},\n` +
        `    description: ${quote(shape.description)},\n` +
        `    fields: [\n${fields}\n    ]\n` +
        `  }`
      )
    })
    .join(',\n')

  const paramRows = params
    .map((name) => `  { name: ${quote(name)}, description: ${quote(PARAMS[name])} }`)
    .join(',\n')

  return `/**
 * Generated by scripts/generate-api-reference.js — do not edit.
 *
 * The field tables come from the interfaces in src/models/PublicContent.ts and
 * the endpoint list from src/routes/api/v1.ts. Change those and re-run the
 * generator; a test fails when this file stops matching them.
 */

export const ENDPOINTS = [
${endpoints}
]

export const QUERY_PARAMS = [
${paramRows}
]

export const SHAPES = [
${shapeBlocks}
]

export const ENVELOPE = {
  item: ${quote(ENVELOPE.item)},
  collection: ${quote(ENVELOPE.collection)},
  error: ${quote(ENVELOPE.error)}
}
`
}

// --- Run ----------------------------------------------------------------------

export function generate() {
  const model = readFileSync(MODEL, 'utf-8')
  const routes = parseRoutes(readFileSync(ROUTES, 'utf-8'))

  assertNothingDocumentedIsDead(routes)

  const declared = Object.keys(PARAMS).sort()
  const used = readQueryParams(readFileSync(CONTROLLER, 'utf-8'), model)

  if (declared.join() !== used.join()) {
    throw new Error(
      `documented query params [${declared}] but the code reads [${used}] — ` +
        'a parameter the API accepts and the docs omit is the drift this generator exists to stop'
    )
  }

  const shapes = SHAPES.map((name) => ({
    name,
    description: interfaceDoc(model, name),
    fields: parseInterface(model, name)
  }))

  return render({ routes, shapes, params: declared })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const generated = generate()

  const flag = process.argv.indexOf('--out')
  const target = flag === -1 ? OUTPUT : process.argv[flag + 1]

  if (flag !== -1 && !target) {
    console.error('--out needs a path')
    process.exit(1)
  }

  if (process.argv.includes('--check')) {
    // A missing file is staleness, not a crash: that is exactly the state the
    // second copy is in before anyone has generated it.
    const current = existsSync(target) ? readFileSync(target, 'utf-8') : null

    if (current !== generated) {
      console.error(`${target} is stale — run: node scripts/generate-api-reference.js --out ${target}`)
      process.exit(1)
    }

    console.log(`${target} is current`)
  } else {
    writeFileSync(target, generated)
    console.log(`wrote ${target}`)
  }
}

// Exported so the drift test can drive them with synthetic input and prove the
// parser fails on what it should fail on, rather than skipping it quietly.
export { OUTPUT, parseInterface, parseRoutes, MODEL }
