/**
 * Private posts and pages, the WordPress way.
 *
 * A private item is published but not public. Signed-in people who can edit it
 * (editors and admins, and a post's own author) see it in the admin; nobody
 * else sees it anywhere — not the content API, the theme, the feeds, the
 * sitemap, oEmbed, search, menus, comments or newsletters.
 *
 * A flag rather than a fourth `status` or a `visibility` level, on purpose:
 *
 * - `status` is the editorial workflow (draft, pending, published) and is kept
 *   in step with the `published` flag every query reads. Private is not a
 *   step in that workflow: a private post can still be scheduled, and making
 *   one public again must not mean republishing it.
 * - `visibility` (migration 034) says who may read the *body* of a post that
 *   is still listed, and its levels belong to the access policy a feature
 *   registers. Private hides the whole item, and must hold with no feature
 *   installed at all.
 *
 * Enforced in one place: `livePost()` and `livePage()` in
 * `src/models/visibility.ts`, which every public read goes through.
 */

export const up = async (db) => {
  await db.exec('ALTER TABLE posts ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0')
  await db.exec('ALTER TABLE pages ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0')
}

export const down = async (db) => {
  await db.exec('ALTER TABLE pages DROP COLUMN is_private')
  await db.exec('ALTER TABLE posts DROP COLUMN is_private')
}
