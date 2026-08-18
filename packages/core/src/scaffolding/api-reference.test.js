/**
 * The consumer API reference is generated, and this is what keeps it that way.
 *
 * `/docs/headless` used to list the endpoints and say nothing about what came
 * back, so the only way to learn the response shape was to read
 * `PublicContent.ts`. Writing the tables by hand would have fixed the symptom
 * and created the disease: a second declaration of the same shape, drifting
 * quietly, the way the entry-point list on the Testing page said nineteen for
 * two releases after it became eighteen.
 *
 * So the tables come from the interfaces, and this file fails when the
 * checked-in output stops matching them. The parser tests use synthetic input
 * rather than the real file, because a test that only ever sees valid input
 * cannot tell you whether the failure it promises would actually happen.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generate, OUTPUT, parseInterface, parseRoutes } from '../../scripts/generate-api-reference.js'
import { compareShape, SHAPES } from '../../scripts/api-reference-shapes.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const DOCS = join(ROOT, 'create-basicben-app/template-ts/src/client/pages/Headless.tsx')

describe('the generated API reference', () => {
  test('the checked-in file is what the generator produces', () => {
    assert.strictEqual(
      readFileSync(OUTPUT, 'utf-8'),
      generate(),
      'api-reference.ts is stale — run: node scripts/generate-api-reference.js'
    )
  })

  test('it documents every shape, with fields', () => {
    const generated = generate()

    for (const shape of ['PublicPost', 'PublicPage', 'PublicCategory', 'PublicTag', 'PublicMedia']) {
      assert.ok(generated.includes(`name: '${shape}'`), `${shape} is missing from the reference`)
    }

    // A parser that returned empty field lists would satisfy every assertion
    // above and document nothing.
    assert.ok(generated.split('description:').length > 40, 'suspiciously few documented fields')
  })

  test('the docs page renders it rather than restating it', () => {
    // The generated module is worthless if nothing imports it, and a hand-written
    // table sitting next to it is the drift this whole approach avoids.
    const page = readFileSync(DOCS, 'utf-8')

    assert.match(page, /from '\.\/api-reference'/, 'the Headless page does not import the reference')
    assert.match(page, /SHAPES\.map/, 'the Headless page does not render the shapes')
    assert.match(page, /ENDPOINTS\.map/, 'the Headless page does not render the endpoints')
  })
})

describe('the interface parser', () => {
  const source = `
export type Format = 'html' | 'markdown'

export interface Thing {
  /** The identifier. */
  id: number
  /** What it is. */
  format: Format
}
`

  test('reads the field, its type and the comment above it', () => {
    const fields = parseInterface(source, 'Thing')

    assert.deepStrictEqual(fields, [
      { name: 'id', type: 'number', optional: false, description: 'The identifier.' },
      { name: 'format', type: "'html' | 'markdown'", optional: false, description: 'What it is.' }
    ])
  })

  test('a field with no comment fails generation', () => {
    // The alternative is a blank cell in the published reference, which reads
    // as "this field has no meaning" rather than "nobody wrote one".
    const undocumented = `
export interface Thing {
  /** The identifier. */
  id: number
  slug: string
}
`
    assert.throws(() => parseInterface(undocumented, 'Thing'), /slug has no doc comment/)
  })

  test('a line it cannot parse fails rather than being skipped', () => {
    // This is the assertion that makes the rest trustworthy: a parser that
    // silently ignores what it does not understand produces a reference quietly
    // missing a field, which is the exact failure being prevented.
    const odd = `
export interface Thing {
  /** The identifier. */
  id: number
  readonly weird: {
    nested: string
  }
}
`
    assert.throws(() => parseInterface(odd, 'Thing'), /cannot parse/)
  })

  test('a missing interface fails', () => {
    assert.throws(() => parseInterface(source, 'Absent'), /not found/)
  })
})

describe('the route parser', () => {
  test('reads the path and resolves the scope through the framework', () => {
    const routes = parseRoutes(`
      const content = requireScope(SCOPES.CONTENT_READ)
      router.get('/api/v1/posts', publicApiLimit, content, cacheable, PublicApiController.posts)
    `)

    assert.deepStrictEqual(routes, [
      { method: 'GET', path: '/api/v1/posts', scope: 'content:read', action: 'posts' }
    ])
  })

  test('an undocumented route fails generation', () => {
    // Adding an endpoint without saying what it returns should stop the build,
    // not ship a reference that omits it.
    assert.throws(
      () =>
        parseRoutes(`
          const content = requireScope(SCOPES.CONTENT_READ)
          router.get('/api/v1/authors', content, PublicApiController.authors)
        `),
      /not documented in ACTIONS/
    )
  })

  test('a scope that no longer exists fails', () => {
    assert.throws(
      () => parseRoutes("const content = requireScope(SCOPES.CONTENT_SUBSCRIBE)"),
      /does not exist/
    )
  })
})

/**
 * The comparison the smoke test runs against a booted server.
 *
 * Generating from the interfaces guarantees the docs match the *types*, which
 * is not the same as matching reality: an interface can promise a field the
 * shaping code never sets, and the cast between row and interface hides it.
 * The smoke test closes that with a live response; these prove the comparison
 * would actually notice.
 */
describe('comparing a documented shape to a real response', () => {
  test('accepts a response carrying exactly the documented fields', () => {
    const sample = Object.fromEntries(
      SHAPES.find((shape) => shape.name === 'PublicMedia').fields.map((field) => [field.name, null])
    )

    assert.deepStrictEqual(compareShape('PublicMedia', sample), { ok: true })
  })

  test('catches a documented field the response does not send', () => {
    const sample = { id: 1, url: 'x', mime_type: 'image/png', size: 1, alt_text: null }
    const result = compareShape('PublicMedia', sample)

    assert.strictEqual(result.ok, false)
    assert.match(result.detail, /documented but absent: created_at/)
  })

  test('catches a field the response sends and the docs never mention', () => {
    // The direction that matters for privacy: a column added to the query
    // reaches consumers whether or not anyone documented it.
    const sample = Object.fromEntries(
      SHAPES.find((shape) => shape.name === 'PublicMedia').fields.map((field) => [field.name, null])
    )
    sample.uploaded_by_email = 'someone@example.com'

    const result = compareShape('PublicMedia', sample)

    assert.strictEqual(result.ok, false)
    assert.match(result.detail, /returned but undocumented: uploaded_by_email/)
  })

  test('an empty collection is a failure, not a pass', () => {
    // Comparing against nothing succeeds trivially, which would make the whole
    // check decorative on any endpoint with no seeded content.
    assert.strictEqual(compareShape('PublicPost', undefined).ok, false)
    assert.match(compareShape('PublicPost', undefined).detail, /did not arrive/)
  })
})
