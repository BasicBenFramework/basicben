import { query } from '@basicbenframework/core/db'

/**
 * Insert a row the model built field by field. Returns the builder's result,
 * whose `lastInsertRowid` is the new id.
 *
 * Core refuses a write that does not name its columns (strict mass
 * assignment, core 0.9). A row written here is an object literal in the
 * model's own code — every key is one the model chose — so its keys are the
 * allowlist. A write that spreads in data from outside (a request body, a
 * caller's record) must not come through here: it names its columns with
 * `only()` itself, so a new key in that data can never reach the table.
 *
 * Inserts go through the query builder rather than raw SQL so Postgres gets a
 * `RETURNING id` and the id comes back; a raw INSERT yields null there.
 */
export async function insertRow(table: string, row: Record<string, unknown>): Promise<{ lastInsertRowid: number | bigint; changes: number }> {
  return (await query(table)).only(...Object.keys(row)).insert(row)
}
