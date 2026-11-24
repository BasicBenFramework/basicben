/**
 * When a new post has enough in it to be saved as a draft.
 *
 * Shared by the editor, which waits for it before its first autosave, and the
 * server, which refuses anything less — so a stray keystroke on New post and a
 * closed tab leave nothing behind. The same lengths a real save asks of a
 * title and a body; either one is enough.
 */
export const AUTOSAVE_MIN_TITLE = 3
export const AUTOSAVE_MIN_CONTENT = 10

export function worthAutosaving(title: unknown, content: unknown): boolean {
  const t = typeof title === 'string' ? title.trim().length : 0
  const c = typeof content === 'string' ? content.trim().length : 0
  return t >= AUTOSAVE_MIN_TITLE || c >= AUTOSAVE_MIN_CONTENT
}

/** The shape of the editor's idempotency key: short, URL-safe, its own. */
export function validAutosaveKey(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value)
}
