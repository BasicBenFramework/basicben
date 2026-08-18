/**
 * Validation system.
 * Simple, composable validation with async support.
 */

import { db } from '../db/index.js'

/**
 * Validate data against rules
 *
 * @param {Object} data - Data to validate
 * @param {Object} schema - Validation schema { field: [rules] }
 * @returns {ValidationResult}
 *
 * @example
 * const result = await validate(req.body, {
 *   email: [rules.required, rules.email],
 *   password: [rules.required, rules.min(8)]
 * })
 *
 * if (result.fails()) {
 *   return res.status(422).json({ errors: result.errors })
 * }
 */
export async function validate(data, schema) {
  const errors = {}

  for (const [field, fieldRules] of Object.entries(schema)) {
    const value = data[field]
    const fieldErrors = []

    for (const rule of fieldRules) {
      // Skip remaining rules if field is optional and empty
      if (rule === rules.optional) {
        if (isEmpty(value)) break
        continue
      }

      const error = await rule(value, field, data)

      if (error) {
        fieldErrors.push(error)
        // Stop on first error for this field
        break
      }
    }

    if (fieldErrors.length > 0) {
      errors[field] = fieldErrors
    }
  }

  return new ValidationResult(errors)
}

/**
 * Validation result class
 */
class ValidationResult {
  constructor(errors) {
    this.errors = errors
  }

  /**
   * Check if validation failed
   */
  fails() {
    return Object.keys(this.errors).length > 0
  }

  /**
   * Check if validation passed
   */
  passes() {
    return !this.fails()
  }

  /**
   * Get first error for a field
   */
  first(field) {
    return this.errors[field]?.[0] || null
  }

  /**
   * Get all errors as flat array
   */
  all() {
    const flat = []
    for (const [field, messages] of Object.entries(this.errors)) {
      for (const message of messages) {
        flat.push({ field, message })
      }
    }
    return flat
  }
}

/**
 * Built-in validation rules
 */
export const rules = {
  /**
   * Field is required
   */
  required: (value, field) => {
    if (isEmpty(value)) {
      return `${field} is required`
    }
    return null
  },

  /**
   * Field is optional (stops validation chain if empty)
   */
  optional: 'optional', // Marker, handled specially in validate()

  /**
   * Must be a string
   */
  string: (value, field) => {
    if (value !== undefined && value !== null && typeof value !== 'string') {
      return `${field} must be a string`
    }
    return null
  },

  /**
   * Must be a number or numeric string
   */
  numeric: (value, field) => {
    if (value !== undefined && value !== null && isNaN(Number(value))) {
      return `${field} must be a number`
    }
    return null
  },

  /**
   * Must be an integer
   */
  integer: (value, field) => {
    if (value !== undefined && value !== null && !Number.isInteger(Number(value))) {
      return `${field} must be an integer`
    }
    return null
  },

  /**
   * Must be a boolean
   */
  boolean: (value, field) => {
    if (value !== undefined && value !== null && typeof value !== 'boolean') {
      return `${field} must be a boolean`
    }
    return null
  },

  /**
   * Must be an array
   */
  array: (value, field) => {
    if (value !== undefined && value !== null && !Array.isArray(value)) {
      return `${field} must be an array`
    }
    return null
  },

  /**
   * Must be a valid email
   */
  email: (value, field) => {
    if (isEmpty(value)) return null
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(value)) {
      return `${field} must be a valid email`
    }
    return null
  },

  /**
   * Must be a valid URL
   */
  url: (value, field) => {
    if (isEmpty(value)) return null
    try {
      new URL(value)
      return null
    } catch {
      return `${field} must be a valid URL`
    }
  },

  /**
   * Minimum length (string) or value (number)
   */
  min: (minValue) => (value, field) => {
    if (isEmpty(value)) return null
    if (typeof value === 'string' && value.length < minValue) {
      return `${field} must be at least ${minValue} characters`
    }
    if (typeof value === 'number' && value < minValue) {
      return `${field} must be at least ${minValue}`
    }
    return null
  },

  /**
   * Maximum length (string) or value (number)
   */
  max: (maxValue) => (value, field) => {
    if (isEmpty(value)) return null
    if (typeof value === 'string' && value.length > maxValue) {
      return `${field} must be at most ${maxValue} characters`
    }
    if (typeof value === 'number' && value > maxValue) {
      return `${field} must be at most ${maxValue}`
    }
    return null
  },

  /**
   * Value must be between min and max (inclusive)
   */
  between: (min, max) => (value, field) => {
    if (isEmpty(value)) return null
    const num = Number(value)
    if (isNaN(num) || num < min || num > max) {
      return `${field} must be between ${min} and ${max}`
    }
    return null
  },

  /**
   * Value must be in allowed list
   */
  in: (...allowed) => (value, field) => {
    if (isEmpty(value)) return null
    if (!allowed.includes(value)) {
      return `${field} must be one of: ${allowed.join(', ')}`
    }
    return null
  },

  /**
   * Value must not be in disallowed list
   */
  notIn: (...disallowed) => (value, field) => {
    if (isEmpty(value)) return null
    if (disallowed.includes(value)) {
      return `${field} must not be one of: ${disallowed.join(', ')}`
    }
    return null
  },

  /**
   * Must match regex pattern
   */
  regex: (pattern) => (value, field) => {
    if (isEmpty(value)) return null
    if (!pattern.test(value)) {
      return `${field} format is invalid`
    }
    return null
  },

  /**
   * Must match another field (e.g., password confirmation)
   */
  confirmed: (confirmField) => (value, field, data) => {
    const confirmFieldName = confirmField || `${field}_confirmation`
    if (value !== data[confirmFieldName]) {
      return `${field} confirmation does not match`
    }
    return null
  },

  /**
   * Must be different from another field
   */
  different: (otherField) => (value, field, data) => {
    if (value === data[otherField]) {
      return `${field} must be different from ${otherField}`
    }
    return null
  },

  /**
   * String must match exact length
   */
  length: (len) => (value, field) => {
    if (isEmpty(value)) return null
    if (typeof value === 'string' && value.length !== len) {
      return `${field} must be exactly ${len} characters`
    }
    return null
  },

  /**
   * Must be alphanumeric
   */
  alphanumeric: (value, field) => {
    if (isEmpty(value)) return null
    if (!/^[a-zA-Z0-9]+$/.test(value)) {
      return `${field} must contain only letters and numbers`
    }
    return null
  },

  /**
   * Must be alpha only
   */
  alpha: (value, field) => {
    if (isEmpty(value)) return null
    if (!/^[a-zA-Z]+$/.test(value)) {
      return `${field} must contain only letters`
    }
    return null
  },

  /**
   * Must be a valid date
   */
  date: (value, field) => {
    if (isEmpty(value)) return null
    const date = new Date(value)
    if (isNaN(date.getTime())) {
      return `${field} must be a valid date`
    }
    return null
  },

  /**
   * Date must be before another date
   */
  before: (dateStr) => (value, field) => {
    if (isEmpty(value)) return null
    const date = new Date(value)
    const beforeDate = new Date(dateStr)
    if (date >= beforeDate) {
      return `${field} must be before ${dateStr}`
    }
    return null
  },

  /**
   * Date must be after another date
   */
  after: (dateStr) => (value, field) => {
    if (isEmpty(value)) return null
    const date = new Date(value)
    const afterDate = new Date(dateStr)
    if (date <= afterDate) {
      return `${field} must be after ${dateStr}`
    }
    return null
  },

  /**
   * Value must be unique in database table
   *
   * @param {string} table - Table name
   * @param {string} [column] - Column name (defaults to field name)
   * @param {number|string} [exceptId] - ID to exclude (for updates)
   *
   * @example
   * // Check email is unique
   * email: [rules.unique('users')]
   *
   * // Check email is unique, excluding current user
   * email: [rules.unique('users', 'email', userId)]
   */
  unique: (table, column, exceptId) => async (value, field) => {
    if (isEmpty(value)) return null

    const col = column || field
    const query = await db.table(table)

    query.where(col, value)

    if (exceptId !== undefined) {
      query.where('id', '!=', exceptId)
    }

    const exists = await query.exists()

    if (exists) {
      return `${field} has already been taken`
    }
    return null
  },

  /**
   * Value must exist in database table
   *
   * @param {string} table - Table name
   * @param {string} [column] - Column name (defaults to 'id')
   *
   * @example
   * // Check user_id exists in users table
   * user_id: [rules.exists('users')]
   *
   * // Check category exists by slug
   * category: [rules.exists('categories', 'slug')]
   */
  exists: (table, column = 'id') => async (value, field) => {
    if (isEmpty(value)) return null

    const query = await db.table(table)
    const exists = await query.where(column, value).exists()

    if (!exists) {
      return `${field} does not exist`
    }
    return null
  }
}

/**
 * Check if value is empty
 */
function isEmpty(value) {
  return value === undefined || value === null || value === ''
}

/**
 * Create custom rule with custom message
 */
export function rule(validator, message) {
  return async (value, field, data) => {
    const result = await validator(value, field, data)
    if (result === false) {
      return typeof message === 'function' ? message(field, value) : message
    }
    return null
  }
}
