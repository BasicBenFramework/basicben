/**
 * Scheduling, the trash, and the helpers they rest on.
 *
 * These import the real modules — Node strips the TypeScript — rather than
 * reading source, because the behaviour is a function of input and output.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { livePost, toStoredTimestamp, parseStoredTimestamp } from '../src/models/visibility.ts'
import { imageSize } from '../src/helpers/image-size.ts'
import { seoFields } from '../src/helpers/seo-fields.ts'
import { responsiveImage } from '../src/helpers/images.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf-8')

describe('what counts as live', () => {
  test('published, not trashed, and its time has come', () => {
    const clause = livePost('p')
    assert.match(clause, /p\.published = 1/)
    assert.match(clause, /p\.deleted_at IS NULL/)
    assert.match(clause, /p\.publish_at IS NULL OR p\.publish_at <= '\d{4}-\d{2}-\d{2}T[\d:.]+Z'/)
  })

  test('no public post query skips the rule', () => {
    for (const file of ['src/models/PublicContent.ts', 'src/models/Category.ts', 'src/models/Tag.ts', 'src/controllers/FeedController.ts']) {
      assert.doesNotMatch(read(file), /\b(p|posts)\.published = 1/, `${file} filters posts without livePost`)
    }
  })

  test('timestamps are stored as UTC and read back as UTC', () => {
    assert.strictEqual(toStoredTimestamp('2026-11-23T10:00:00+02:00'), '2026-11-23T08:00:00.000Z')
    assert.strictEqual(toStoredTimestamp(''), null)
    assert.throws(() => toStoredTimestamp('not a date'))
    // SQLite's CURRENT_TIMESTAMP form carries no zone and is UTC.
    assert.strictEqual(parseStoredTimestamp('2026-11-23 08:00:00'), Date.UTC(2026, 10, 23, 8))
  })
})

describe('image headers', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d494844520000028000000168080600000000', 'hex')
  const gif = Buffer.from('474946383961' + '4001' + 'f000' + '0000', 'hex')

  test('PNG and GIF dimensions are read', () => {
    assert.deepStrictEqual(imageSize(png), { type: 'image/png', width: 640, height: 360 })
    assert.deepStrictEqual(imageSize(gif), { type: 'image/gif', width: 320, height: 240 })
  })

  test('JPEG walks its segments to the frame header', () => {
    const jpeg = Buffer.from(
      'ffd8' + 'ffe0' + '0010' + '4a46494600010100000100010000' + 'ffc0' + '0011' + '08' + '01e0' + '0280' + '03' + '012200021101031101',
      'hex'
    )
    assert.deepStrictEqual(imageSize(jpeg), { type: 'image/jpeg', width: 640, height: 480 })
  })

  test('a document labelled as an image is not an image', () => {
    assert.strictEqual(imageSize(Buffer.from('<html><script>alert(1)</script>')), null)
    assert.strictEqual(imageSize(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null)
  })
})

describe('social and indexing fields', () => {
  test('a canonical URL must be absolute http(s)', () => {
    assert.ok('errors' in seoFields({ canonical_url: 'javascript:alert(1)' }))
    assert.ok('errors' in seoFields({ canonical_url: '/relative' }))
    assert.deepStrictEqual(seoFields({ canonical_url: 'https://example.com/a' }), { values: { canonical_url: 'https://example.com/a' } })
  })

  test('absent keys stay absent, so an old client blanks nothing', () => {
    assert.deepStrictEqual(seoFields({ title: 'x' }), { values: {} })
  })

  test('image ids are ids or null', () => {
    assert.deepStrictEqual(seoFields({ og_image: '', twitter_image: '7' }), { values: { og_image: null, twitter_image: 7 } })
  })
})

describe('responsive images', () => {
  test('no transform configured: dimensions, no srcset', () => {
    delete process.env.IMAGE_TRANSFORM_URL
    assert.deepStrictEqual(responsiveImage('https://cdn.test/a.jpg', { width: 1000, height: 500 }), {
      url: 'https://cdn.test/a.jpg', width: 1000, height: 500, alt: null, srcset: null
    })
  })

  test('a transform template never upscales', () => {
    process.env.IMAGE_TRANSFORM_URL = '{url}?w={width}'
    const image = responsiveImage('https://cdn.test/a.jpg', { width: 1000 })
    assert.strictEqual(image.srcset, 'https://cdn.test/a.jpg?w=320 320w, https://cdn.test/a.jpg?w=640 640w, https://cdn.test/a.jpg?w=960 960w, https://cdn.test/a.jpg?w=1000 1000w')
    delete process.env.IMAGE_TRANSFORM_URL
  })
})

describe('the trash and revisions', () => {
  const controller = read('src/controllers/PostController.ts')

  test('deleting trashes first, and only a trashed post is deleted for good', () => {
    assert.match(controller, /const permanent = Boolean\(post\.deleted_at\)/)
    assert.match(controller, /await Post\.trash\(post\.id\)/)
  })

  test('every update records what it replaced', () => {
    assert.match(controller, /await PostRevision\.snapshot\(post, changes, req\.userId \?\? null\)/)
  })

  test('bulk actions check each post as the single endpoint would', () => {
    assert.match(controller, /if \(!post \|\| !mayEdit\(req, post\)\)/)
  })
})
