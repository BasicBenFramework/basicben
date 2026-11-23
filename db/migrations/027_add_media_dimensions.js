/**
 * Image dimensions.
 *
 * Without them a front end cannot reserve space for an image before it loads
 * (the page jumps as it arrives), cannot emit `width`/`height` attributes, and
 * cannot build a `srcset` without guessing which sizes are worth asking a CDN
 * for. Read from the file's own header at upload; null for anything that is
 * not an image, or was uploaded before this.
 */

export const up = async (db) => {
  await db.exec('ALTER TABLE media ADD COLUMN width INTEGER')
  await db.exec('ALTER TABLE media ADD COLUMN height INTEGER')
}

export const down = async (db) => {
  await db.exec('ALTER TABLE media DROP COLUMN height')
  await db.exec('ALTER TABLE media DROP COLUMN width')
}
