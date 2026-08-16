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
