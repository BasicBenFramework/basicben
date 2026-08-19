/**
 * Fill in the slugs and excerpts nothing ever wrote.
 *
 * `posts.slug` and `posts.excerpt` arrived with migration 009 and the editor
 * has shown both fields ever since, but `store` and `update` read only title,
 * content and published — the same fault the taxonomy had. So both columns are
 * null on every post this CMS has written, which is why the content API
 * documents a slug as "null on posts written before slugs existed": in practice
 * that was all of them, and a consumer building URLs had to fall back to ids.
 *
 * The controller derives both from now on. This is the catch-up for what is
 * already in the table, so nothing has to be opened and re-saved to get a URL.
 *
 * Only null columns are touched. An imported post that already has a slug keeps
 * it — changing a published URL is not a migration's business.
 */

import { slugify, excerpt } from '@basicbenframework/core/content'

export const up = async (db) => {
  const posts = await db.all(
    'SELECT id, title, content, slug, excerpt FROM posts ORDER BY id ASC'
  )

  // Seeded with what the table already holds, so a generated slug cannot
  // collide with one an import wrote. `posts.slug` is uniquely indexed, and a
  // collision here would fail the whole migration.
  const taken = new Set(posts.map((post) => post.slug).filter(Boolean))

  for (const post of posts) {
    if (!post.slug) {
      const base = slugify(post.title || '') || `post-${post.id}`

      let slug = base
      let suffix = 2

      while (taken.has(slug)) slug = `${base}-${suffix++}`

      taken.add(slug)

      await db.run('UPDATE posts SET slug = ? WHERE id = ?', [slug, post.id])
    }

    if (!post.excerpt && post.content) {
      await db.run('UPDATE posts SET excerpt = ? WHERE id = ?', [
        excerpt(post.content),
        post.id
      ])
    }
  }
}

export const down = async () => {
  // Deliberately empty. The columns existed before this ran; the values it
  // wrote are indistinguishable from ones an author typed, and blanking every
  // slug on a rollback would break every URL the site had just published.
}
