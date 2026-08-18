/**
 * Rewrite `?` placeholders as `$1, $2, …`.
 *
 * The query builder already emits the right form through `Grammar`, but
 * hand-written SQL does not, and there is a lot of hand-written SQL: the
 * template's models are full of `WHERE id = ?`. Portable migrations only get an
 * app as far as a schema it then cannot query, so the translation belongs here,
 * once, rather than in every model.
 *
 * Two things are deliberately left alone:
 *
 *  - **Anything inside a string literal.** `WHERE note = 'why?'` binds nothing.
 *  - **jsonb operators.** Postgres spells key-existence `?`, `?|` and `?&`, and
 *    a query written against Postgres on purpose must survive being run.
 *
 * SQL that already uses `$n` is returned untouched, so builder output and
 * anything a user wrote for Postgres directly are both safe.
 *
 * @param {string} sql
 * @returns {string}
 */
export function toNumberedPlaceholders(sql: string): string;
/**
 * Settings for the connection pool.
 *
 * Separate from the adapter so they can be asserted without a Postgres server.
 *
 * @param {string} url - Postgres connection string
 * @param {Object} options - Additional options
 * @returns {Object} Options for pg's Pool
 */
export function poolOptions(url: string, options?: any): any;
/**
 * Create Postgres adapter
 *
 * @param {string} url - Postgres connection string
 * @param {Object} options - Additional options
 */
export function createPostgresAdapter(url: string, options?: any): Promise<{
    /**
     * Driver name for query builder
     */
    driver: string;
    /**
     * Run INSERT/UPDATE/DELETE
     */
    run(sql: any, params?: any[]): Promise<{
        lastInsertRowid: any;
        changes: any;
    }>;
    /**
     * Get single row
     */
    get(sql: any, params?: any[]): Promise<any>;
    /**
     * Get all rows
     */
    all(sql: any, params?: any[]): Promise<any>;
    /**
     * Execute raw SQL
     */
    exec(sql: any): Promise<void>;
    /**
     * Run function in transaction
     */
    transaction(fn: any): Promise<any>;
    /**
     * Close connection pool
     */
    close(): Promise<void>;
    /**
     * Get underlying pool
     */
    readonly raw: any;
}>;
