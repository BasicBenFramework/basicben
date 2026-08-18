/**
 * Check the published API reference against what the API actually returns.
 *
 * The reference is generated from the interfaces, so it cannot drift from the
 * *types*. That is not the same as being true: an interface can promise a field
 * the shaping code never sets, and TypeScript is happy either way because the
 * row it maps from is cast. This closes that gap by comparing the documented
 * field list to the keys of a real response from a booted server.
 *
 * Both directions are checked. A documented field missing from the response is
 * a lie; an undocumented field present in it is a field consumers will find and
 * depend on without being told whether it is stable.
 *
 * Usage: node scripts/api-reference-smoke.mjs <baseUrl> <token>
 */

import { compareShape } from './api-reference-shapes.mjs'

const BASE = process.argv[2] || 'http://localhost:3987'
const TOKEN = process.argv[3]

if (!TOKEN) {
  console.error('usage: api-reference-smoke.mjs <baseUrl> <token>')
  process.exit(2)
}

let failures = 0
const pass = (message) => console.log(`\x1b[32m✓\x1b[0m ${message}`)
const fail = (message, detail) => {
  console.log(`\x1b[31m✗\x1b[0m ${message}${detail ? `\n  ${detail}` : ''}`)
  failures++
}

const api = async (path, options = {}) => {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
      ...options.headers
    }
  })

  const text = await response.text()

  try {
    return { status: response.status, body: JSON.parse(text) }
  } catch {
    return { status: response.status, body: { raw: text.slice(0, 200) } }
  }
}

// --- Fixtures ------------------------------------------------------------------
//
// An empty collection would let every comparison pass by having nothing to
// compare, which is the failure mode this whole file exists to avoid. The seeds
// create posts; a page, a category and a tag have to be made here.

const page = await api('/api/pages', {
  method: 'POST',
  body: JSON.stringify({
    title: 'Reference probe',
    slug: 'reference-probe',
    content: 'A published page, so /api/v1/pages has something in it.',
    published: true
  })
})

if (page.status !== 201 && page.status !== 200) {
  fail('a published page can be created', `${page.status} ${JSON.stringify(page.body)}`)
} else {
  pass('a published page can be created')
}

const category = await api('/api/categories', {
  method: 'POST',
  body: JSON.stringify({ name: 'Reference', slug: 'reference', description: 'Probe category.' })
})

if (category.status !== 201 && category.status !== 200) {
  fail('a category can be created', `${category.status} ${JSON.stringify(category.body)}`)
} else {
  pass('a category can be created')
}

const tag = await api('/api/tags', {
  method: 'POST',
  body: JSON.stringify({ name: 'Reference tag', slug: 'reference-tag' })
})

if (tag.status !== 201 && tag.status !== 200) {
  fail('a tag can be created', `${tag.status} ${JSON.stringify(tag.body)}`)
} else {
  pass('a tag can be created')
}

// --- The documented shapes are the real ones ----------------------------------

const CHECKS = [
  { shape: 'PublicPost', path: '/api/v1/posts', collection: true },
  { shape: 'PublicPage', path: '/api/v1/pages', collection: true },
  { shape: 'PublicCategory', path: '/api/v1/categories', collection: false },
  { shape: 'PublicTag', path: '/api/v1/tags', collection: false }
]

for (const check of CHECKS) {
  const response = await api(check.path)

  if (response.status !== 200) {
    fail(`${check.path} responds`, `${response.status} ${JSON.stringify(response.body)}`)
    continue
  }

  const data = response.body?.data
  const sample = Array.isArray(data) ? data[0] : data

  const result = compareShape(check.shape, sample)

  if (result.ok) pass(`${check.shape} matches what ${check.path} returns`)
  else fail(`${check.shape} matches what ${check.path} returns`, result.detail)

  // The envelope is documented too, and `total_pages` is the field a paginating
  // client loops on.
  if (check.collection) {
    const meta = response.body?.meta
    const keys = meta ? Object.keys(meta).sort().join(',') : ''

    if (keys !== 'page,per_page,total,total_pages') {
      fail(`${check.path} carries the documented meta`, `got [${keys}]`)
    } else {
      pass(`${check.path} carries the documented meta`)
    }
  }
}

// --- And the documented error body --------------------------------------------

const missing = await api('/api/v1/posts/no-such-post-anywhere')

if (missing.status !== 404) {
  fail('an unknown slug is a 404', String(missing.status))
} else if (!missing.body?.error || 'data' in missing.body) {
  // Documented as `{ "error": ... }` with no `data`. A body carrying both would
  // make "did it work" ambiguous for every consumer.
  fail('a 404 carries error and no data', JSON.stringify(missing.body))
} else {
  pass('a 404 carries the documented error body')
}

console.log('')
process.exit(failures === 0 ? 0 : 1)
