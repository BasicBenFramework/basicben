/**
 * Query Builder - fluent API for building safe SQL queries.
 * Provides mass assignment protection and identifier escaping.
 */

import { Grammar } from './Grammar.js'

export class QueryBuilder {
  /**
   * Create a new QueryBuilder instance.
   *
   * @param {Object} db - Database adapter instance
   * @param {string} table - Table name
   * @param {string} driver - Database driver ('sqlite' or 'postgres')
   */
  constructor(db, table, driver = 'sqlite') {
    this.db = db
    this.grammar = new Grammar(driver)

    // Validate and store table name
    this.grammar.validateId(table)
    this.table = table

    // Mass assignment protection
    this._fillable = null  // Whitelist (null = allow all except guarded)
    this._guarded = ['id']  // Blacklist (always protected by default)

    // Query state
    this._select = ['*']
    this._wheres = []
    this._orderBy = []
    this._limit = null
    this._offset = null
    this._params = []
  }

  /**
   * Set fillable columns (whitelist).
   * Only these columns will be allowed in insert/update operations.
   *
   * @param {...string} columns - Column names to allow
   * @returns {QueryBuilder}
   */
  only(...columns) {
    this._fillable = columns.flat()
    return this
  }

  /**
   * Set guarded columns (blacklist).
   * These columns will be excluded from insert/update operations.
   *
   * @param {...string} columns - Column names to exclude
   * @returns {QueryBuilder}
   */
  except(...columns) {
    this._guarded = columns.flat()
    return this
  }

  /**
   * Filter data object to only allowed columns.
   * Validates identifiers and applies fillable/guarded rules.
   *
   * @param {Object} data - Data object to filter
   * @returns {Object} Filtered data
   * @throws {Error} If an invalid identifier is found
   */
  filterData(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Data must be an object')
    }

    const filtered = {}

    for (const [key, value] of Object.entries(data)) {
      // Validate identifier (throws if invalid)
      this.grammar.validateId(key)

      // Check fillable whitelist
      if (this._fillable !== null && !this._fillable.includes(key)) {
        continue
      }

      // Check guarded blacklist
      if (this._guarded.includes(key)) {
        continue
      }

      filtered[key] = value
    }

    return filtered
  }

  /**
   * Set columns to select.
   *
   * @param {...string} columns - Column names
   * @returns {QueryBuilder}
   */
  select(...columns) {
    const cols = columns.flat()

    this._select = cols.map(col => {
      if (col === '*') return '*'
      return this.grammar.escapeId(col)
    })

    return this
  }

  /**
   * Add a WHERE clause.
   *
   * @param {string} column - Column name
   * @param {*} [operator='='] - Comparison operator, or the value itself in the
   *   two-argument shorthand `where(column, value)`
   * @param {*} [value] - Value to compare
   * @returns {QueryBuilder}
   */
  where(column, operator, value) {
    // Support where(column, value) shorthand
    if (value === undefined) {
      value = operator
      operator = '='
    }

    this.grammar.validateId(column)
    const validOp = this.grammar.validateOperator(operator)

    this._wheres.push({
      column,
      operator: validOp,
      paramIndex: this._params.length
    })

    this._params.push(value)

    return this
  }

  /**
   * Add a WHERE NULL clause.
   *
   * @param {string} column - Column name
   * @returns {QueryBuilder}
   */
  whereNull(column) {
    this.grammar.validateId(column)

    this._wheres.push({
      column,
      operator: 'IS',
      value: 'NULL',
      raw: true
    })

    return this
  }

  /**
   * Add a WHERE NOT NULL clause.
   *
   * @param {string} column - Column name
   * @returns {QueryBuilder}
   */
  whereNotNull(column) {
    this.grammar.validateId(column)

    this._wheres.push({
      column,
      operator: 'IS NOT',
      value: 'NULL',
      raw: true
    })

    return this
  }

  /**
   * Add ORDER BY clause.
   *
   * @param {string} column - Column name
   * @param {string} [direction='ASC'] - Sort direction
   * @returns {QueryBuilder}
   */
  orderBy(column, direction = 'ASC') {
    this.grammar.validateId(column)
    const dir = this.grammar.validateDirection(direction)

    this._orderBy.push({ column, direction: dir })

    return this
  }

  /**
   * Set LIMIT.
   *
   * @param {number} n - Number of rows
   * @returns {QueryBuilder}
   */
  limit(n) {
    const num = parseInt(n, 10)
    if (isNaN(num) || num < 0) {
      throw new Error('Limit must be a non-negative integer')
    }
    this._limit = num
    return this
  }

  /**
   * Set OFFSET.
   *
   * @param {number} n - Number of rows to skip
   * @returns {QueryBuilder}
   */
  offset(n) {
    const num = parseInt(n, 10)
    if (isNaN(num) || num < 0) {
      throw new Error('Offset must be a non-negative integer')
    }
    this._offset = num
    return this
  }

  /**
   * Build the WHERE clause SQL.
   *
   * @returns {{ sql: string, startIndex: number }}
   */
  _buildWhereClause(startIndex = 0) {
    if (this._wheres.length === 0) {
      return { sql: '', startIndex }
    }

    // Count only bound clauses: raw ones (IS NULL and friends) contribute no
    // parameter, and getParams() filters them out. Indexing by position in
    // _wheres would skip numbers and leave placeholders unbound on Postgres.
    let bound = 0
    const clauses = this._wheres.map((w) => {
      const col = this.grammar.escapeId(w.column)

      if (w.raw) {
        return `${col} ${w.operator} ${w.value}`
      }

      const placeholder = this.grammar.placeholder(startIndex + bound)
      bound++
      return `${col} ${w.operator} ${placeholder}`
    })

    return {
      sql: ` WHERE ${clauses.join(' AND ')}`,
      startIndex: startIndex + this._wheres.filter(w => !w.raw).length
    }
  }

  /**
   * Build SELECT query SQL.
   *
   * @returns {string}
   */
  toSql() {
    const table = this.grammar.escapeId(this.table)
    let sql = `SELECT ${this._select.join(', ')} FROM ${table}`

    // WHERE
    const { sql: whereClause } = this._buildWhereClause(0)
    sql += whereClause

    // ORDER BY
    if (this._orderBy.length > 0) {
      const orders = this._orderBy.map(o =>
        `${this.grammar.escapeId(o.column)} ${o.direction}`
      )
      sql += ` ORDER BY ${orders.join(', ')}`
    }

    // LIMIT
    if (this._limit !== null) {
      sql += ` LIMIT ${this._limit}`
    }

    // OFFSET
    if (this._offset !== null) {
      sql += ` OFFSET ${this._offset}`
    }

    return sql
  }

  /**
   * Get the parameters for the current query.
   *
   * @returns {Array}
   */
  getParams() {
    return this._wheres.filter(w => !w.raw).map(w => this._params[w.paramIndex])
  }

  /**
   * Execute SELECT and return all rows.
   *
   * @returns {Promise<Array>}
   */
  async get() {
    const sql = this.toSql()
    const params = this.getParams()
    return this.db.all(sql, params)
  }

  /**
   * Execute SELECT and return first row.
   *
   * @returns {Promise<Object|undefined>}
   */
  async first() {
    this._limit = 1
    const sql = this.toSql()
    const params = this.getParams()
    return this.db.get(sql, params)
  }

  /**
   * Find a record by ID.
   *
   * @param {number|string} id - The ID to find
   * @returns {Promise<Object|undefined>}
   */
  async find(id) {
    return this.where('id', id).first()
  }

  /**
   * Execute INSERT.
   *
   * @param {Object} data - Data to insert
   * @returns {Promise<{ lastInsertRowid: number, changes: number }>}
   */
  async insert(data) {
    const filtered = this.filterData(data)
    const keys = Object.keys(filtered)
    const values = Object.values(filtered)

    if (keys.length === 0) {
      throw new Error('No valid columns to insert')
    }

    const table = this.grammar.escapeId(this.table)
    const columns = keys.map(k => this.grammar.escapeId(k)).join(', ')
    const placeholders = keys.map((_, i) => this.grammar.placeholder(i)).join(', ')

    let sql = `INSERT INTO ${table} (${columns}) VALUES (${placeholders})`

    if (this.grammar.supportsReturning()) {
      sql += ' RETURNING id'
    }

    return this.db.run(sql, values)
  }

  /**
   * Execute UPDATE.
   *
   * @param {Object} data - Data to update
   * @returns {Promise<{ lastInsertRowid: number, changes: number }>}
   */
  async update(data) {
    const filtered = this.filterData(data)
    const keys = Object.keys(filtered)
    const values = Object.values(filtered)

    if (keys.length === 0) {
      throw new Error('No valid columns to update')
    }

    const table = this.grammar.escapeId(this.table)
    const whereParams = this.getParams()

    // Build SET clause with correct placeholder indices
    const setClause = keys.map((k, i) => {
      const placeholder = this.grammar.placeholder(i)
      return `${this.grammar.escapeId(k)} = ${placeholder}`
    }).join(', ')

    let sql = `UPDATE ${table} SET ${setClause}`

    // WHERE clause, numbered after the SET parameters. Same rule as
    // _buildWhereClause: only bound clauses consume a placeholder.
    if (this._wheres.length > 0) {
      let bound = 0
      const clauses = this._wheres.map((w) => {
        if (w.raw) {
          return `${this.grammar.escapeId(w.column)} ${w.operator} ${w.value}`
        }
        const placeholder = this.grammar.placeholder(keys.length + bound)
        bound++
        return `${this.grammar.escapeId(w.column)} ${w.operator} ${placeholder}`
      })
      sql += ` WHERE ${clauses.join(' AND ')}`
    }

    return this.db.run(sql, [...values, ...whereParams])
  }

  /**
   * Execute DELETE.
   *
   * @returns {Promise<{ lastInsertRowid: number, changes: number }>}
   */
  async delete() {
    const table = this.grammar.escapeId(this.table)
    let sql = `DELETE FROM ${table}`

    const { sql: whereClause } = this._buildWhereClause(0)
    sql += whereClause

    return this.db.run(sql, this.getParams())
  }

  /**
   * Get COUNT of matching rows.
   *
   * @returns {Promise<number>}
   */
  async count() {
    const table = this.grammar.escapeId(this.table)
    let sql = `SELECT COUNT(*) as count FROM ${table}`

    const { sql: whereClause } = this._buildWhereClause(0)
    sql += whereClause

    const result = await this.db.get(sql, this.getParams())
    return result?.count || 0
  }

  /**
   * Check if any matching rows exist.
   *
   * @returns {Promise<boolean>}
   */
  async exists() {
    const count = await this.count()
    return count > 0
  }

  /**
   * Paginate results.
   *
   * @param {number} page - Page number (1-indexed)
   * @param {number} perPage - Items per page
   * @returns {Promise<{ data: Array, total: number, page: number, perPage: number, totalPages: number }>}
   */
  async paginate(page = 1, perPage = 15) {
    const pageNum = Math.max(1, parseInt(page, 10))
    const perPageNum = Math.max(1, parseInt(perPage, 10))

    // Get total count (clone query state)
    const total = await this.count()

    // Get paginated data
    this._limit = perPageNum
    this._offset = (pageNum - 1) * perPageNum

    const data = await this.get()

    return {
      data,
      total,
      page: pageNum,
      perPage: perPageNum,
      totalPages: Math.ceil(total / perPageNum)
    }
  }
}

/**
 * Create a new QueryBuilder instance.
 * Factory function for cleaner syntax.
 *
 * @param {Object} db - Database adapter
 * @param {string} table - Table name
 * @param {string} driver - Database driver
 * @returns {QueryBuilder}
 */
export function query(db, table, driver = 'sqlite') {
  return new QueryBuilder(db, table, driver)
}
