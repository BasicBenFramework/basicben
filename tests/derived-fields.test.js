/**
 * Slugs and excerpts write themselves, and a featured image reaches the row.
 *
 * The editor has shown a slug field, an excerpt field, an SEO panel and a
 * featured image since migration 009. `store` and `update` read title, content
 * and published. Everything else was accepted by the API and written nowhere —
 * the same fault the taxonomy had, and just as quiet: nothing errored, the
 * fields kept their values until the page was reloaded, and every post this CMS
 * created had a null slug. That is why the content API documents a slug as
 * "null on posts written before slugs existed": in practice that was all of
 * them, and a consumer building URLs had to fall back to ids.
 *
 * So the columns are persisted, and the two that are derivable derive
 * themselves. Three cases, deliberately different: a typed value is kept, a
 * blank one is derived, and an absent one leaves what is already there — which
 * is what keeps a permalink still when someone fixes a typo in a headline.
 *
 * Pages gained the featured image they never had, and stopped re-deriving their
 * slug on every save, which silently moved published URLs.
 *
 * Behaviour was verified against a running server and against the models
 * directly: a second "Hello World" becomes `hello-world-2`, retitling leaves the
 * URL alone, clearing the field asks for a new one, and a title-only PUT no
 * longer unpublishes a page.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf-8')

describe('deriving a slug and an excerpt', () => {
  const derive = read('src/models/derive.ts')

  test('the framework does the slugifying and the summarising', () => {
    // A second implementation of "what is a summary" is a second answer, one of
    // which ends mid-word.
    assert.match(derive, /import \{ slugify, excerpt \} from '@basicbenframework\/core\/content'/)
  })

  test('a clash is numbered rather than refused', () => {
    // posts.slug and pages.slug are uniquely indexed, so the alternative to
    // renaming is a failed write in the middle of someone's save.
    assert.match(derive, /slug = `\$\{base\}-\$\{suffix\+\+\}`/)
  })

  test('a row does not collide with itself when it is updated', () => {
    assert.match(derive, /WHERE slug = \? AND id != \?/)
  })

  test('absent, blank and typed are three different instructions', () => {
    assert.match(derive, /const slugMentioned = input\.slug !== undefined/)
    assert.match(derive, /!slugMentioned && options\.existingSlug/)
    assert.match(derive, /excerptMentioned\s*\?\s*typedExcerpt \|\| summarise/)
  })

  test('the table name can only be a table', () => {
    // It is interpolated into SQL, so it is a union of literals rather than a
    // string a caller supplies.
    assert.match(derive, /export type Sluggable = 'posts' \| 'pages' \| 'users'/)
  })
})

describe('a post keeps what the editor sent it', () => {
  const controller = read('src/controllers/PostController.ts')
  const model = read('src/models/Post.ts')

  test('the SEO panel, the excerpt and the slug reach the controller', () => {
    for (const field of ['slug', 'excerpt', 'meta_title', 'meta_description', 'publish_at']) {
      assert.match(controller, new RegExp(`'${field}'`), `${field} is still being dropped`)
    }
  })

  test('they reach the row as well', () => {
    assert.match(model, /slug: derived\.slug,\s*\n\s*excerpt: derived\.excerpt,/)
    assert.match(model, /featured_image: data\.featured_image \?\? null/)
  })

  test('an update writes only columns, not whatever keys arrived', () => {
    assert.match(model, /UPDATABLE\.includes\(key\) && value !== undefined/)
  })

  test('a request that says nothing about publishing does not unpublish', () => {
    // `published: body.published ? 1 : 0` turned every partial update into an
    // unpublish, which is a content outage rather than a bug report.
    assert.match(controller, /published === undefined \? \{\} : \{ published: published \? 1 : 0 \}/)
    assert.match(read('src/models/Page.ts'), /if \(data\.published !== undefined\)/)
  })

  test('an empty picker clears the image instead of writing an empty string', () => {
    assert.match(controller, /Number\.isInteger\(id\) && id > 0 \? id : null/)
  })

  test('rows written before any of this get their slug and excerpt', () => {
    const migration = read('db/migrations/022_backfill_post_slugs_and_excerpts.js')

    assert.match(migration, /UPDATE posts SET slug = \? WHERE id = \?/)
    assert.match(migration, /UPDATE posts SET excerpt = \? WHERE id = \?/)
    // A generated slug must not collide with one an import already wrote.
    assert.match(migration, /new Set\(posts\.map\(\(post\) => post\.slug\)\.filter\(Boolean\)\)/)
  })

  test('the backfill leaves a slug an import already chose', () => {
    assert.match(read('db/migrations/022_backfill_post_slugs_and_excerpts.js'), /if \(!post\.slug\)/)
  })
})

describe('a page has a featured image too', () => {
  test('the column is a media id with an index on it', () => {
    const migration = read('db/migrations/021_add_page_featured_image.js')

    assert.match(migration, /ALTER TABLE pages ADD COLUMN featured_image INTEGER REFERENCES media\(id\)/)
    assert.match(migration, /CREATE INDEX idx_pages_featured_image/)
  })

  test('every page read resolves it to a URL', () => {
    // posts rendered `/uploads/3` for a while by handing the front end a media
    // id where it wanted a URL; there is no reason to repeat it.
    const model = read('src/models/Page.ts')

    assert.match(model, /LEFT JOIN media ON media\.id = pages\.featured_image/)
    assert.match(model, /storage\.publicUrl\(row\.featured_image_path\)/)
  })

  test('a client that does not know about images does not strip one', () => {
    assert.match(
      read('src/controllers/PageController.ts'),
      /'featured_image' in req\.body \? \{ featured_image: mediaId\(featured_image\) \} : \{\}/
    )
  })

  test('the public shape carries it', () => {
    const publicContent = read('src/models/PublicContent.ts')
    const pageShape = publicContent.slice(publicContent.indexOf('export interface PublicPage'))

    assert.match(pageShape.slice(0, pageShape.indexOf('\n}')), /featured_image_url: string \| null/)
  })

  test('retitling a page no longer moves its URL', () => {
    const model = read('src/models/Page.ts')

    assert.doesNotMatch(model, /data\.slug = slugify\(data\.title\)/)
    assert.match(model, /const wantsSlug = data\.slug !== undefined/)
  })
})

describe('the editor knows which thing it is editing', () => {
  const editor = read('src/client/pages/admin/PostEditor.tsx')

  test('the content type comes from the path', () => {
    // /admin/pages/new has always opened this component, and this component has
    // always saved to /api/posts — so creating a page created a post, which
    // then did not appear in the list you came from.
    assert.match(editor, /const isPage = path\.startsWith\('\/admin\/pages'\)/)
    assert.match(editor, /api\.put\(`\/api\/\$\{resource\}\/\$\{postId\}`/)
    assert.match(editor, /api\.post\(`\/api\/\$\{resource\}`/)
  })

  test('a page is not offered boxes it has no columns for', () => {
    assert.match(editor, /\{!isPage && \(/)
  })

  test('the resolved image URL is not sent back as the image', () => {
    // featured_image holds a media id; a URL in that column is a foreign key
    // that points at nothing.
    assert.match(editor, /const \{ featured_image_url, user_id, category_ids, tags, excerpt, \.\.\.common \} = formData/)
  })

  test('the slug that will be generated is visible before the save', () => {
    assert.match(editor, /placeholder=\{slugify\(formData\.title\)/)
  })

  test('the slug sits under the title, not in an SEO panel below the fold', () => {
    // It is the post's address, derived from the title as you type it — so it
    // belongs next to the title rather than three cards further down, and there
    // is only one field for it either way.
    const title = editor.indexOf('placeholder={`Enter ${noun.toLowerCase()} title`}')
    const slug = editor.indexOf('className="admin-slug"')
    const seo = editor.indexOf('SEO Settings')

    assert.ok(slug > title && slug < seo, 'the slug field is not between the title and the SEO card')
    assert.strictEqual(editor.split('name="slug"').length - 1, 1, 'two fields are bound to the slug')
  })

  test('the selection is visible without scrolling a list to find it', () => {
    // Ticked boxes eight rows down a scrolling list are not a selection you can
    // read. Both taxonomies show what is on the post as removable chips, above
    // the control rather than below it.
    assert.match(editor, /formData\.category_ids\.length > 0 && \(\s*\n\s*<div className="admin-term-chips">/)
    assert.match(editor, /formData\.tags\.length > 0 && \(\s*\n\s*<div className="admin-term-chips">/)

    const layout = read('src/client/layouts/AdminLayout.tsx')
    const chips = layout.slice(layout.indexOf('.admin-term-chips {'))

    assert.match(chips.slice(0, chips.indexOf('}')), /margin-bottom/)
  })
})
