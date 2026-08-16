/**
 * Create a new QueryBuilder instance.
 * Factory function for cleaner syntax.
 *
 * @param {Object} db - Database adapter
 * @param {string} table - Table name
 * @param {string} driver - Database driver
 * @returns {QueryBuilder}
 */
export function query(db: any, table: string, driver?: string): QueryBuilder;
export class QueryBuilder {
    /**
     * Create a new QueryBuilder instance.
     *
     * @param {Object} db - Database adapter instance
     * @param {string} table - Table name
     * @param {string} driver - Database driver ('sqlite' or 'postgres')
     */
    constructor(db: any, table: string, driver?: string);
    db: any;
    grammar: Grammar;
    table: string;
    _fillable: string[];
    _guarded: string[];
    _select: string[];
    _wheres: any[];
    _orderBy: any[];
    _limit: number;
    _offset: number;
    _params: any[];
    /**
     * Set fillable columns (whitelist).
     * Only these columns will be allowed in insert/update operations.
     *
     * @param {...string} columns - Column names to allow
     * @returns {QueryBuilder}
     */
    only(...columns: string[]): QueryBuilder;
    /**
     * Set guarded columns (blacklist).
     * These columns will be excluded from insert/update operations.
     *
     * @param {...string} columns - Column names to exclude
     * @returns {QueryBuilder}
     */
    except(...columns: string[]): QueryBuilder;
    /**
     * Filter data object to only allowed columns.
     * Validates identifiers and applies fillable/guarded rules.
     *
     * @param {Object} data - Data object to filter
     * @returns {Object} Filtered data
     * @throws {Error} If an invalid identifier is found
     */
    filterData(data: any): any;
    /**
     * Set columns to select.
     *
     * @param {...string} columns - Column names
     * @returns {QueryBuilder}
     */
    select(...columns: string[]): QueryBuilder;
    /**
     * Add a WHERE clause.
     *
     * @param {string} column - Column name
     * @param {*} [operator='='] - Comparison operator, or the value itself in the
     *   two-argument shorthand `where(column, value)`
     * @param {*} [value] - Value to compare
     * @returns {QueryBuilder}
     */
    where(column: string, operator?: any, value?: any): QueryBuilder;
    /**
     * Add a WHERE NULL clause.
     *
     * @param {string} column - Column name
     * @returns {QueryBuilder}
     */
    whereNull(column: string): QueryBuilder;
    /**
     * Add a WHERE NOT NULL clause.
     *
     * @param {string} column - Column name
     * @returns {QueryBuilder}
     */
    whereNotNull(column: string): QueryBuilder;
    /**
     * Add ORDER BY clause.
     *
     * @param {string} column - Column name
     * @param {string} [direction='ASC'] - Sort direction
     * @returns {QueryBuilder}
     */
    orderBy(column: string, direction?: string): QueryBuilder;
    /**
     * Set LIMIT.
     *
     * @param {number} n - Number of rows
     * @returns {QueryBuilder}
     */
    limit(n: number): QueryBuilder;
    /**
     * Set OFFSET.
     *
     * @param {number} n - Number of rows to skip
     * @returns {QueryBuilder}
     */
    offset(n: number): QueryBuilder;
    /**
     * Build the WHERE clause SQL.
     *
     * @returns {{ sql: string, startIndex: number }}
     */
    _buildWhereClause(startIndex?: number): {
        sql: string;
        startIndex: number;
    };
    /**
     * Build SELECT query SQL.
     *
     * @returns {string}
     */
    toSql(): string;
    /**
     * Get the parameters for the current query.
     *
     * @returns {Array}
     */
    getParams(): any[];
    /**
     * Execute SELECT and return all rows.
     *
     * @returns {Promise<Array>}
     */
    get(): Promise<any[]>;
    /**
     * Execute SELECT and return first row.
     *
     * @returns {Promise<Object|undefined>}
     */
    first(): Promise<any | undefined>;
    /**
     * Find a record by ID.
     *
     * @param {number|string} id - The ID to find
     * @returns {Promise<Object|undefined>}
     */
    find(id: number | string): Promise<any | undefined>;
    /**
     * Execute INSERT.
     *
     * @param {Object} data - Data to insert
     * @returns {Promise<{ lastInsertRowid: number, changes: number }>}
     */
    insert(data: any): Promise<{
        lastInsertRowid: number;
        changes: number;
    }>;
    /**
     * Execute UPDATE.
     *
     * @param {Object} data - Data to update
     * @returns {Promise<{ lastInsertRowid: number, changes: number }>}
     */
    update(data: any): Promise<{
        lastInsertRowid: number;
        changes: number;
    }>;
    /**
     * Execute DELETE.
     *
     * @returns {Promise<{ lastInsertRowid: number, changes: number }>}
     */
    delete(): Promise<{
        lastInsertRowid: number;
        changes: number;
    }>;
    /**
     * Get COUNT of matching rows.
     *
     * @returns {Promise<number>}
     */
    count(): Promise<number>;
    /**
     * Check if any matching rows exist.
     *
     * @returns {Promise<boolean>}
     */
    exists(): Promise<boolean>;
    /**
     * Paginate results.
     *
     * @param {number} page - Page number (1-indexed)
     * @param {number} perPage - Items per page
     * @returns {Promise<{ data: Array, total: number, page: number, perPage: number, totalPages: number }>}
     */
    paginate(page?: number, perPage?: number): Promise<{
        data: any[];
        total: number;
        page: number;
        perPage: number;
        totalPages: number;
    }>;
}
import { Grammar } from './Grammar.js';
