/**
 * Create the Turso adapter.
 *
 * @param {string} url - libsql://, https:// or http:// URL
 * @param {Object} options
 * @param {string} [options.authToken] - defaults to TURSO_AUTH_TOKEN
 * @param {number} [options.timeout] - per-request timeout in ms
 * @param {typeof fetch} [options.fetch] - injectable for tests
 */
export function createTursoAdapter(url: string, options?: {
    authToken?: string;
    timeout?: number;
    fetch?: typeof fetch;
}): Promise<{
    /**
     * Execute a multi-statement script.
     *
     * Hrana's `sequence` is built for exactly this — migrations arrive as one
     * string of semicolon-separated statements. It discards result rows and
     * stops at the first failure, which is what a migration wants.
     */
    exec(sql: any): Promise<void>;
    /**
     * Run a function inside a transaction.
     *
     * The baton is what makes this work: every statement has to travel on the
     * same stream as the BEGIN, or it lands outside the transaction entirely.
     * The callback receives a transaction-scoped adapter, matching the SQLite
     * and Postgres adapters so the same code ports between drivers.
     */
    transaction(fn: any): Promise<any>;
    /**
     * No connection to close — every stream is released as it is used.
     */
    close(): Promise<void>;
    driver: string;
    run(sql: any, params?: any[]): Promise<{
        lastInsertRowid: number | bigint;
        changes: number;
    }>;
    get(sql: any, params?: any[]): Promise<any>;
    all(sql: any, params?: any[]): Promise<any>;
}>;
/**
 * Normalize a libSQL URL to the HTTP endpoint.
 *
 * @param {string} url
 * @returns {string}
 */
export function toHttpUrl(url: string): string;
/**
 * JS value → Hrana Value.
 *
 * @param {*} value
 * @returns {Object}
 */
export function encodeValue(value: any): any;
/**
 * Hrana Value → JS value.
 *
 * @param {Object} value
 * @returns {*}
 */
export function decodeValue(value: any): any;
