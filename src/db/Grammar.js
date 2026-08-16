/**
 * SQL Grammar - handles dialect differences and identifier escaping.
 * Provides protection against SQL injection for identifiers (column/table names).
 */

export class Grammar {
  constructor(driver = 'sqlite') {
    this.driver = driver
  }

  /**
   * Whether this dialect needs a RETURNING clause to report a new row's id.
   *
   * The Postgres adapter reads lastInsertRowid from the returned row, so an
   * INSERT without RETURNING yields a null id.
   *
   * @returns {boolean}
   */
  supportsReturning() {
    return this.driver === 'postgres' || this.driver === 'pg' || this.driver === 'neon'
  }

  /**
   * Validate an identifier (column/table name).
   * Only allows alphanumeric characters and underscores.
   * Must start with a letter or underscore.
   *
   * @param {string} name - The identifier to validate
   * @returns {string} The validated identifier
   * @throws {Error} If the identifier is invalid
   */
  validateId(name) {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('Identifier must be a non-empty string')
    }

    if (name.length > 128) {
      throw new Error(`Identifier too long: ${name.slice(0, 20)}...`)
    }

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new Error(
        `Invalid identifier "${name}". ` +
        'Identifiers must contain only letters, numbers, and underscores, ' +
        'and must start with a letter or underscore.'
      )
    }

    return name
  }

  /**
   * Escape an identifier for safe use in SQL.
   * Validates first, then wraps in quotes with proper escaping.
   *
   * @param {string} name - The identifier to escape
   * @returns {string} The escaped identifier
   */
  escapeId(name) {
    // Validate first
    this.validateId(name)

    // MySQL/PlanetScale uses backticks for identifiers
    if (this.driver === 'planetscale' || this.driver === 'mysql') {
      return `\`${name.replace(/`/g, '``')}\``
    }

    // SQLite, Postgres, Turso, Neon use double quotes for identifiers
    return `"${name.replace(/"/g, '""')}"`
  }

  /**
   * Get the placeholder syntax for the current driver.
   *
   * @param {number} index - Zero-based parameter index
   * @returns {string} The placeholder string
   */
  placeholder(index) {
    // Postgres and Neon use $1, $2, etc.
    if (this.driver === 'postgres' || this.driver === 'pg' || this.driver === 'neon') {
      return `$${index + 1}`
    }
    // SQLite, Turso, PlanetScale use ?
    return '?'
  }

  /**
   * Validate an operator for WHERE clauses.
   *
   * @param {string} operator - The operator to validate
   * @returns {string} The validated operator
   * @throws {Error} If the operator is not allowed
   */
  validateOperator(operator) {
    const allowed = ['=', '!=', '<>', '<', '>', '<=', '>=', 'LIKE', 'NOT LIKE', 'IN', 'NOT IN', 'IS', 'IS NOT']
    const upper = operator.toUpperCase()

    if (!allowed.includes(upper)) {
      throw new Error(`Invalid operator: ${operator}`)
    }

    return upper
  }

  /**
   * Validate sort direction.
   *
   * @param {string} direction - ASC or DESC
   * @returns {string} The validated direction
   */
  validateDirection(direction) {
    const upper = (direction || 'ASC').toUpperCase()

    if (upper !== 'ASC' && upper !== 'DESC') {
      throw new Error(`Invalid sort direction: ${direction}`)
    }

    return upper
  }

  /**
   * Build a column list for SELECT.
   *
   * @param {string[]} columns - Array of column names
   * @returns {string} Escaped column list
   */
  columnList(columns) {
    if (!columns || columns.length === 0) {
      return '*'
    }

    return columns.map(col => {
      if (col === '*') return '*'
      return this.escapeId(col)
    }).join(', ')
  }
}
