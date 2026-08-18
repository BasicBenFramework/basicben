/**
 * SQL Grammar - handles dialect differences and identifier escaping.
 * Provides protection against SQL injection for identifiers (column/table names).
 */
export class Grammar {
    constructor(driver?: string);
    driver: string;
    /**
     * Whether the driver speaks the Postgres dialect.
     *
     * @returns {boolean}
     */
    isPostgres(): boolean;
    /**
     * Whether this dialect needs a RETURNING clause to report a new row's id.
     *
     * The Postgres adapter reads lastInsertRowid from the returned row, so an
     * INSERT without RETURNING yields a null id.
     *
     * @returns {boolean}
     */
    supportsReturning(): boolean;
    /**
     * Column definition for an auto-incrementing integer primary key.
     *
     * SQLite spells this INTEGER PRIMARY KEY AUTOINCREMENT; Postgres has no such
     * keyword and rejects the statement outright.
     *
     * @returns {string}
     */
    autoIncrementPrimaryKey(): string;
    /**
     * Column type for a timestamp. DATETIME is a SQLite spelling; Postgres wants
     * TIMESTAMP. CURRENT_TIMESTAMP works as a default in both.
     *
     * @returns {string}
     */
    timestampType(): string;
    /**
     * A DROP TABLE that works when other tables reference this one.
     *
     * Postgres refuses to drop a table another table has a foreign key into,
     * unless told to CASCADE — which drops the dependent *constraint*, not the
     * dependent table. SQLite has no such clause and does not object.
     *
     * Without this, rolling back was SQLite-only even once the forward
     * migrations were portable: `DROP TABLE media` failed on Postgres because
     * `posts.featured_image` referenced it, and the rollback stopped half-done.
     *
     * @param {string} table
     * @returns {string}
     */
    dropTable(table: string): string;
    /**
     * Validate an identifier (column/table name).
     * Only allows alphanumeric characters and underscores.
     * Must start with a letter or underscore.
     *
     * @param {string} name - The identifier to validate
     * @returns {string} The validated identifier
     * @throws {Error} If the identifier is invalid
     */
    validateId(name: string): string;
    /**
     * Escape an identifier for safe use in SQL.
     * Validates first, then wraps in quotes with proper escaping.
     *
     * @param {string} name - The identifier to escape
     * @returns {string} The escaped identifier
     */
    escapeId(name: string): string;
    /**
     * Get the placeholder syntax for the current driver.
     *
     * @param {number} index - Zero-based parameter index
     * @returns {string} The placeholder string
     */
    placeholder(index: number): string;
    /**
     * Validate an operator for WHERE clauses.
     *
     * @param {string} operator - The operator to validate
     * @returns {string} The validated operator
     * @throws {Error} If the operator is not allowed
     */
    validateOperator(operator: string): string;
    /**
     * Validate sort direction.
     *
     * @param {string} direction - ASC or DESC
     * @returns {string} The validated direction
     */
    validateDirection(direction: string): string;
    /**
     * Build a column list for SELECT.
     *
     * @param {string[]} columns - Array of column names
     * @returns {string} Escaped column list
     */
    columnList(columns: string[]): string;
}
