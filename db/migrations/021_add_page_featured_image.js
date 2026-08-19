/**
 * Pages get a featured image, the way posts already had one.
 *
 * `posts.featured_image` arrived with migration 009 and pages were left out,
 * so a landing page built here could carry a hero image only by writing the
 * Markdown for it inside the body — which puts it in the middle of the content
 * rather than beside it, where a template, an Open Graph tag or a card listing
 * could find it.
 *
 * A foreign key into `media`, not a URL, for the same reason posts store one:
 * moving buckets or putting a CDN in front of one should not mean rewriting
 * every row.
 */

export const up = async (db) => {
  await db.exec('ALTER TABLE pages ADD COLUMN featured_image INTEGER REFERENCES media(id)')
  await db.exec('CREATE INDEX idx_pages_featured_image ON pages(featured_image)')
}

export const down = async (db) => {
  await db.exec('DROP INDEX IF EXISTS idx_pages_featured_image')
  await db.exec('ALTER TABLE pages DROP COLUMN featured_image')
}
