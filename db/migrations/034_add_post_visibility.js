/**
 * Who may read a post, and whether it goes out by email.
 *
 * `visibility` is `public` (everyone, the default and what every existing post
 * stays), `members` (any signed-in member) or `paid`. `paid` is reserved for
 * paid subscriptions, which do not exist yet; until they do it is enforced
 * exactly like `members`. Hiding it from everyone — the only other reading of
 * a tier nobody can hold yet — is not what an author choosing it meant.
 *
 * A gated post is still *listed*: its title, excerpt, image and dates are
 * public, as on Ghost, so a reader can see what they would get by signing in.
 * Only the body is withheld. See `src/helpers/gating.ts`.
 *
 * `send_newsletter` is the author's request to email the post to members when
 * it goes live. A request, not a record: whether it has been sent is the
 * `newsletter_sends` row (migration 035), whose unique `post_id` is what makes
 * "once per post" a constraint rather than a hope.
 */

export const up = async (db) => {
  await db.exec("ALTER TABLE posts ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'")
  await db.exec('ALTER TABLE posts ADD COLUMN send_newsletter INTEGER NOT NULL DEFAULT 0')
}

export const down = async (db) => {
  await db.exec('ALTER TABLE posts DROP COLUMN send_newsletter')
  await db.exec('ALTER TABLE posts DROP COLUMN visibility')
}
