/**
 * Create SQLite adapter
 *
 * @param {string} url - Path to SQLite database file
 * @param {Object} options - Additional options
 */
export function createSqliteAdapter(url: string, options?: any): Promise<{
    /**
     * Driver name for query builder
     */
    driver: string;
    /**
     * Run INSERT/UPDATE/DELETE
     */
    run(sql: any, params?: any[]): {
        lastInsertRowid: number | bigint;
        changes: number | bigint;
    };
    /**
     * Get single row
     */
    get(sql: any, params?: any[]): Record<string, import("node:sqlite").SQLOutputValue>;
    /**
     * Get all rows
     */
    all(sql: any, params?: any[]): Record<string, import("node:sqlite").SQLOutputValue>[];
    /**
     * Execute raw SQL (multiple statements)
     */
    exec(sql: any): void;
    /**
     * Run function in transaction.
     *
     * The callback receives the adapter so the same code works against Postgres,
     * which passes a transaction-scoped adapter. The result is awaited: an async
     * callback would otherwise commit before its work finished, and a rejection
     * would escape the rollback.
     *
     * A nested call joins the transaction already open instead of starting
     * another, which SQLite refuses outright ("cannot start a transaction
     * within a transaction"). Only the outermost call commits or rolls back, so
     * an inner failure still unwinds the whole thing — there are no savepoints
     * here and a partial rollback would be worse than none. The depth counter
     * is safe because this connection is synchronous: nothing else can be
     * mid-transaction on it.
     */
    transaction(fn: any): Promise<any>;
    /**
     * Close database connection
     */
    close(): void;
    /**
     * Get underlying DatabaseSync instance
     */
    readonly raw: DatabaseSync;
}>;
import { DatabaseSync } from 'node:sqlite';
