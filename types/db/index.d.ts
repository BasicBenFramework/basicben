/**
 * Database adapter interface:
 *
 * - run(sql, params)     → { lastInsertRowid, changes }
 * - get(sql, params)     → single row or undefined
 * - all(sql, params)     → array of rows
 * - exec(sql)            → run raw SQL (for migrations)
 * - transaction(fn)      → wrap fn in BEGIN/COMMIT
 * - close()              → close connection
 */
/**
 * Get or create database connection
 */
export function getDb(): Promise<any>;
/**
 * Work out the driver from the environment when the config does not name one.
 *
 * A connection string already says which database it points at, so requiring
 * `driver` alongside it is a step that only exists to be forgotten. An explicit
 * `driver` in basicben.config.js always wins.
 *
 * @param {Object} dbConfig
 * @returns {string}
 */
export function detectDriver(dbConfig?: any): string;
/**
 * Resolve the connection URL for a driver.
 *
 * Turso reads TURSO_URL as well, since that is the variable its own tooling
 * prints and the one the templates document.
 *
 * @param {Object} dbConfig
 * @param {string} driver
 * @returns {string}
 */
export function resolveUrl(dbConfig?: any, driver?: string): string;
/**
 * Reset connection (for testing)
 */
export function resetDb(): void;
/**
 * Create a query builder for a table.
 * Provides fluent API with mass assignment protection.
 *
 * @param {string} table - Table name
 * @returns {Promise<QueryBuilder>}
 *
 * @example
 * const users = await query('users').where('active', true).get()
 * await query('users').only('name', 'email').insert(req.body)
 */
export function query(table: string): Promise<QueryBuilder>;
export namespace db {
    function run(sql: any, params: any): Promise<any>;
    function get(sql: any, params: any): Promise<any>;
    function all(sql: any, params: any): Promise<any>;
    function exec(sql: any): Promise<any>;
    function transaction(fn: any): Promise<any>;
    function close(): Promise<void>;
    /**
     * Create a query builder for a table.
     * Provides fluent API with mass assignment protection.
     *
     * @param {string} table - Table name
     * @returns {Promise<QueryBuilder>}
     */
    function table(table: string): Promise<QueryBuilder>;
}
export { QueryBuilder } from "./QueryBuilder.js";
export { Grammar } from "./Grammar.js";
import { QueryBuilder } from './QueryBuilder.js';
