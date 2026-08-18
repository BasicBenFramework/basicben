/**
 * Compare a documented response shape against a real one.
 *
 * Shared by `api-reference-smoke.mjs` and `storage-smoke.mjs`: the media shape
 * can only be checked where a media row exists, which is the middle of the
 * upload flow, and the rest are checked against seeded content. Two callers,
 * one field list — putting the comparison in either script would have meant
 * copying it into the other.
 */

import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REFERENCE = join(
  dirname(fileURLToPath(import.meta.url)),
  '../apps/cms/src/client/pages/api-reference.ts'
)

export const { SHAPES } = await import(REFERENCE)

/**
 * @param {string} shapeName - an interface name from the generated reference
 * @param {unknown} sample - one object from a live response
 * @returns {{ ok: boolean, detail?: string }}
 */
export function compareShape(shapeName, sample) {
  const shape = SHAPES.find((entry) => entry.name === shapeName)

  if (!shape) return { ok: false, detail: `${shapeName} is not in the reference at all` }

  if (!sample || typeof sample !== 'object') {
    // An empty collection would otherwise let the comparison pass by having
    // nothing to compare, which is the failure this exists to catch.
    return { ok: false, detail: `no ${shapeName} to compare against — the fixture did not arrive` }
  }

  const documented = shape.fields.map((field) => field.name).sort()
  const actual = Object.keys(sample).sort()

  const missing = documented.filter((name) => !actual.includes(name))
  const extra = actual.filter((name) => !documented.includes(name))

  if (missing.length === 0 && extra.length === 0) return { ok: true }

  return {
    ok: false,
    detail: [
      missing.length ? `documented but absent: ${missing.join(', ')}` : '',
      extra.length ? `returned but undocumented: ${extra.join(', ')}` : ''
    ]
      .filter(Boolean)
      .join('; ')
  }
}
