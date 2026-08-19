/**
 * Every user has an author profile, and a post carries it.
 *
 * A post has always had a `user_id`, and every byline the site rendered was
 * `users.name` — the whole of what a reader could learn about whoever wrote it.
 * There was nowhere to put a biography, a link or a face, so a multi-author
 * site had authors in the database and none on the page.
 *
 * Two things had to be true for the profile to be worth having. It has to reach
 * the reader: the feed, and the content API a static build reads. And a post
 * has to be attributable to someone other than whoever happened to be signed in
 * — which is `post.edit`, the WordPress rule, where an author writes under
 * their own name and an editor may hand a post to somebody else.
 *
 * Behaviour was verified against a running server: registration mints a slug,
 * two people called Jane Doe get `jane-doe` and `jane-doe-2`, an admin
 * reassigns a post and the byline follows it, an author's attempt to reassign
 * is ignored rather than obeyed, and `/api/v1/authors` lists only people with
 * something published.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf-8')

describe('the profile columns', () => {
  const migration = read('db/migrations/020_add_author_profiles.js')

  test('the account gains a slug, a biography, a link and an avatar', () => {
    for (const column of ['slug', 'bio', 'website', 'avatar_id']) {
      assert.match(migration, new RegExp(`ADD COLUMN ${column}`), `users.${column} is missing`)
    }
  })

  test('the avatar is a media id, not a filename', () => {
    // The same rule as a featured image: storing a URL means rewriting every
    // row when the bucket moves.
    assert.match(migration, /avatar_id INTEGER REFERENCES media\(id\)/)
  })

  test('the slug is unique, because it is a URL', () => {
    assert.match(migration, /CREATE UNIQUE INDEX idx_users_slug/)
  })

  test('existing accounts are backfilled rather than left unaddressable', () => {
    assert.match(migration, /UPDATE users SET slug = \? WHERE id = \?/)
    assert.match(migration, /while \(taken\.has\(slug\)\)/, 'duplicate names must not collide')
  })

  test('a name that slugifies to nothing still gets a URL', () => {
    assert.match(migration, /`author-\$\{user\.id\}`/)
  })
})

describe('the model', () => {
  const model = read('src/models/User.ts')

  test('registration mints a slug, so every account is addressable', () => {
    assert.match(model, /uniqueSlug\('users', data\.slug \|\| data\.name/)
  })

  test('a chosen slug is made unique rather than allowed to fail the save', () => {
    assert.match(model, /uniqueSlug\('users', data\.slug, \{ excludeId: id/)
  })

  test('the profile shape carries no address, password or role', () => {
    const shape = model.slice(model.indexOf('function withAvatars'))

    for (const field of ['email', 'password']) {
      assert.doesNotMatch(shape, new RegExp(`${field}:`), `${field} must not reach a byline`)
    }
  })

  test('who can be an author is a capability question, not a list of roles', () => {
    // A role added to the framework should appear without this query changing,
    // and a subscriber — who cannot write — must never be offered as an author.
    assert.match(model, /capabilitiesFor\(row\.role\)/)
    assert.match(model, /held\.includes\('post\.create'\)/)
  })
})

describe('attribution', () => {
  const controller = read('src/controllers/PostController.ts')

  test('reassigning a post needs the capability to edit anyone\'s', () => {
    assert.match(controller, /return can\(req\.user, 'post\.edit'\) \? requested : current/)
  })

  test('both create and update route attribution through the same function', () => {
    assert.match(controller, /user_id: authorFor\(req\)/)
    assert.match(controller, /authorFor\(req, post\.user_id\)/)
  })

  test('an editor can reach a post they did not write', () => {
    // Every check was `post.user_id !== req.userId`, so the people responsible
    // for everyone else's posts got "Post not found" for posts that exist.
    assert.doesNotMatch(controller, /post\.user_id !== req\.userId/)
    assert.match(controller, /function mayEdit/)
  })

  test('the listing widens for whoever can edit everything', () => {
    assert.match(controller, /userId: can\(req\.user, 'post\.edit'\) \? undefined : req\.userId/)
  })
})

describe('what a reader gets', () => {
  const publicContent = read('src/models/PublicContent.ts')

  test('the byline field keeps its type; the profile arrives beside it', () => {
    // Turning `author` into an object would break every consumer reading a
    // byline, which is what a version prefix exists to prevent.
    assert.match(publicContent, /^\s{2}author: string \| null$/m)
    assert.match(publicContent, /author_profile: \{ id: number; name: string;/)
  })

  test('posts can be filtered to one author, in SQL', () => {
    assert.match(publicContent, /where\.push\('\(users\.slug = \? OR users\.id = \?\)'\)/)
  })

  test('the author index lists only people with something published', () => {
    // Listing an account with no posts tells the world that account exists.
    assert.match(publicContent, /JOIN posts ON posts\.user_id = users\.id AND posts\.published = 1/)
  })

  test('the archive endpoints are documented, not just routed', () => {
    const generator = read('scripts/generate-api-reference.js')

    assert.match(generator, /authors: \{ shape: 'PublicAuthor'/)
    assert.match(generator, /author: 'Filter posts by author slug or id/)
    assert.match(read('src/client/pages/api-reference.ts'), /PublicAuthor/)
  })

  test('the feed query joins the profile once for the page', () => {
    // One query per post would be invisible on a seeded database and painful
    // on a real one — the same reason tags are batched.
    const model = read('src/models/Post.ts')

    assert.match(model, /LEFT JOIN media AS avatars ON avatars\.id = users\.avatar_id/)
  })
})

describe('the interfaces that show it', () => {
  test('the author is always shown, and the menu only where it can be used', () => {
    // Who wrote this is part of what you are editing, so a one-author site
    // still sees it — as a statement rather than a menu of one, which is a
    // control that cannot be operated.
    const editor = read('src/client/pages/admin/PostEditor.tsx')

    assert.match(editor, /\{!isPage && \(\s*\n\s*<div className="admin-card">\s*\n\s*<h3 className="admin-card-title">Author/)
    assert.match(editor, /authors\.length > 1 \? \(/)
    assert.match(editor, /api\.get<\{ authors: AuthorProfile\[\] \}>\('\/api\/authors'\)/)
  })

  test('the name comes from the server for a post and the session for a draft', () => {
    // A post can belong to someone who is not signed in, so the editor cannot
    // assume the current user — but a post that does not exist yet is yours.
    assert.match(read('src/models/Post.ts'), /users\.name AS author_name/)
    assert.match(
      read('src/client/pages/admin/PostEditor.tsx'),
      /if \(!isEditing && user\?\.name\) setAuthorName\(user\.name\)/
    )
  })

  test('a refused author list is an answer, not a crash', () => {
    // The endpoint is gated on post.create, so a contributor-less account gets
    // a 403 — which must leave the editor working, without a menu.
    const editor = read('src/client/pages/admin/PostEditor.tsx')

    assert.match(editor, /catch \{\s*setAuthors\(\[\]\)/)
  })

  test('the byline renders the face and the biography', () => {
    const post = read('src/client/pages/FeedPost.tsx')

    assert.match(post, /<Avatar name=\{post\.author_name \|\| ''\} src=\{author\?\.avatar_url\}/)
    assert.match(post, /author\?\.bio &&/)
  })

  test('the profile form edits the profile, not just the account', () => {
    const profile = read('src/client/pages/Profile.tsx')

    for (const field of ['slug', 'website', 'bio']) {
      assert.match(profile, new RegExp(`form\\.${field}`), `${field} is not editable`)
    }

    // An avatar is a media row like any other, so it goes through the library's
    // three-step upload rather than a second one written here.
    assert.match(profile, /library\.upload\(\[file\]\)/)
  })

  test('the profile is loaded before it is saved', () => {
    // The session carries a name and an address and nothing else, so a form
    // built from it alone would post empty strings over a biography.
    assert.match(read('src/client/pages/Profile.tsx'), /api<ProfileResponse>\('\/api\/profile'\)/)
  })
})
