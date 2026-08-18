/**
 * The admin navigates without reloading, and its tables page on the server.
 *
 * Both were the same kind of problem: something correct-looking that quietly
 * did far more work than it needed to. Every sidebar click was a plain anchor,
 * so the browser threw the app away and fetched it again — a white flash, the
 * bundle re-parsed, every request re-issued. Every listing fetched the whole
 * table, so the query, the JSON and the DOM grew with the content.
 *
 * These are source checks. The behaviour itself was verified in a browser:
 * clicking a sidebar link kept a `window` marker alive and left the navigation
 * count at one, which is only possible without a document load.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf-8')

/** Every .tsx under src/client, recursively. */
function clientFiles(dir = 'src/client', found = []) {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`

    if (entry.isDirectory()) clientFiles(path, found)
    else if (entry.name.endsWith('.tsx')) found.push(path)
  }

  return found
}

describe('navigation does not reload the document', () => {
  test('no component renders a bare anchor to an internal route', () => {
    // External links stay plain anchors — there is nothing for the router to
    // do with them, and Link would pass them through anyway. Only an href
    // pointing back into this app is a reload waiting to happen.
    //
    // The one exception is Link itself, which is where the anchor lives.
    const internalAnchor = /<a\s[^>]*href=(["']\/(?!\/)|\{)/

    const offenders = clientFiles()
      .filter((file) => file !== 'src/client/components/Link.tsx')
      .filter((file) => internalAnchor.test(read(file)))

    assert.deepStrictEqual(
      offenders,
      [],
      'these render <a> to an internal route; use Link so the router handles the click'
    )
  })

  test('Link keeps the anchor rather than becoming a button', () => {
    const link = read('src/client/components/Link.tsx')

    // A button loses the status bar, "copy link address", open-in-new-tab and
    // the fact that assistive technology announces it as a link.
    assert.match(link, /<a href=\{href\}/)
  })

  test('Link leaves the browser its own shortcuts', () => {
    const link = read('src/client/components/Link.tsx')

    // Swallowing these would take away behaviour an anchor is expected to have:
    // cmd/ctrl for a new tab, shift for a window, middle-click likewise.
    for (const key of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
      assert.ok(link.includes(key), `Link must not intercept ${key} clicks`)
    }

    assert.match(link, /event\.button !== 0/, 'only the primary button should be intercepted')
    assert.match(link, /defaultPrevented/, 'a click already handled upstream should be left alone')
  })

  test('Link passes external links through untouched', () => {
    const link = read('src/client/components/Link.tsx')

    assert.match(link, /href\.startsWith\('\/'\)/)
    assert.match(link, /!href\.startsWith\('\/\/'\)/, 'protocol-relative URLs are external')
  })
})

describe('admin listings page on the server', () => {
  test('the window is clamped, so no caller can ask for the whole table', () => {
    const pagination = read('src/models/pagination.ts')

    assert.match(pagination, /MAX_PER_PAGE = 100/)
    assert.match(pagination, /Math\.min\(MAX_PER_PAGE/)
  })

  test('bad input falls back instead of erroring', () => {
    const pagination = read('src/models/pagination.ts')

    // A listing is not the place to argue about input: a malformed page number
    // should show page one, not a 422.
    assert.match(pagination, /Math\.max\(1,/)
  })

  test('total_pages is computed once, not by every caller', () => {
    const pagination = read('src/models/pagination.ts')

    assert.match(pagination, /Math\.ceil\(total \/ perPage\)/)
  })

  test('the queries order by a total, not a partial, ordering', () => {
    // created_at alone is not unique — rows land in the same second routinely.
    // An unspecified order is untidy until you paginate it, and then
    // LIMIT/OFFSET can serve a row on two pages and never serve another.
    for (const [file, table] of [['src/models/Post.ts', 'posts'], ['src/models/Page.ts', 'pages']]) {
      const source = read(file)
      const paged = source.match(new RegExp(`SELECT \\* FROM ${table}[^']*LIMIT \\? OFFSET \\?`))

      assert.ok(paged, `${file} should have a windowed query`)
      assert.match(
        paged[0],
        /ORDER BY created_at DESC, id DESC/,
        `${file}: paginating an unstable order skips and duplicates rows`
      )
    }
  })

  test('counts survive Postgres returning bigints as strings', () => {
    for (const file of ['src/models/Post.ts', 'src/models/Page.ts']) {
      assert.match(read(file), /Number\(counted\?\.total\)/, `${file} must coerce the count`)
    }
  })

  test('both listings return meta alongside their rows', () => {
    for (const file of ['src/controllers/PostController.ts', 'src/controllers/PageController.ts']) {
      const source = read(file)

      assert.match(source, /paginationFrom\(req\.query/)
      assert.match(source, /meta\(page, perPage, total\)/)
    }
  })

  test('deleting a row reloads the page rather than splicing it out', () => {
    // The view is a window on the server's ordering, so dropping a row locally
    // leaves the page one short and hides whatever should have moved up.
    for (const file of ['src/client/pages/admin/Posts.tsx', 'src/client/pages/admin/Pages.tsx']) {
      const source = read(file)

      assert.doesNotMatch(
        source,
        /set(Posts|Pages)\(\w+\.filter\(/,
        `${file} still splices the deleted row out of local state`
      )
    }
  })
})
