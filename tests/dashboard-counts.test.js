/**
 * The dashboard counts the database rather than the page it was handed.
 *
 * Two faults behind one wrong number. `/api/posts` and `/api/pages` are
 * paginated — twenty rows by default — and the dashboard counted the array it
 * got back, so the Posts card read "20" on a site with twenty posts, two
 * hundred, or two thousand. The listing has sent a `meta.total` alongside the
 * rows since pagination arrived; nothing was reading it.
 *
 * The second was worse and quieter. The four stat requests went out as a single
 * `Promise.all`, and an author holds neither `page.edit` nor `comment.moderate`
 * — so two of the four came back 403, the whole `Promise.all` rejected, and the
 * catch left `stats` null. Every card on an author's dashboard read zero,
 * including the count of the posts they had just written.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf-8')

const dashboard = read('src/client/pages/admin/Dashboard.tsx')

describe('the stat cards report totals, not page sizes', () => {
  test('the count comes from meta, not from the rows returned', () => {
    assert.match(dashboard, /posts: postsRes\?\.meta\?\.total \?\? null/)
    assert.match(dashboard, /pages: pagesRes\?\.meta\?\.total \?\? null/)

    // The old count, in either spelling. Both are the length of one page.
    assert.doesNotMatch(dashboard, /posts\?\.length/)
    assert.doesNotMatch(dashboard, /pages\?\.length/)
  })

  test('the listings actually send the total the dashboard now reads', () => {
    // A count read from a key the server does not send is the same bug wearing
    // a different number.
    assert.match(read('src/controllers/PostController.ts'), /res\.json\(\{ posts, meta: meta\(page, perPage, total\), counts: /)
    assert.match(read('src/controllers/PageController.ts'), /res\.json\(\{ pages, meta: meta\(page, perPage, total\) \}\)/)
  })

  test('only the rows it shows are asked for', () => {
    // Five rows are rendered. Twenty posts and twenty pages were being fetched,
    // bodies and all, to draw two numbers and a short table.
    assert.match(dashboard, /'\/api\/posts\?per_page=5'/)
    assert.match(dashboard, /'\/api\/pages\?per_page=1'/)
    assert.match(dashboard, /setRecentPosts\(postsRes\?\.posts \?\? \[\]\)/)

    // Which only works because the five that come back are the five most
    // recent; the listing orders by created_at descending.
    assert.match(read('src/models/Post.ts'), /ORDER BY posts\.created_at DESC, posts\.id DESC/)
  })
})

describe('one refused stat does not blank the others', () => {
  test('each request settles on its own', () => {
    assert.match(dashboard, /const settle = <T,>\(request: Promise<T>\): Promise<T \| null> =>\s*\n\s*request\.catch\(\(\) => null\)/)

    // Every one of the four, so no single 403 can take the rest with it.
    assert.strictEqual(dashboard.split('settle(api.get').length - 1, 4)
  })

  test('a stat that was refused is missing rather than zero', () => {
    // "0 Pending Comments" shown to somebody who may not moderate them is a
    // number the dashboard has no way to know.
    assert.match(dashboard, /pendingComments: number \| null/)
    assert.match(dashboard, /typeof card\.value === 'number'/)
  })

  test('the grid narrows to the cards there are', () => {
    // Two cards in a four-column grid is two cards and two empty quarters.
    assert.match(dashboard, /admin-grid-\$\{Math\.min\(4, Math\.max\(2, cards\.length\)\)\}/)

    const layout = read('src/client/layouts/AdminLayout.tsx')

    for (const columns of [2, 3, 4]) {
      assert.match(layout, new RegExp(`\\.admin-grid-${columns} \\{`), `there is no ${columns}-column grid to narrow to`)
    }
  })
})
