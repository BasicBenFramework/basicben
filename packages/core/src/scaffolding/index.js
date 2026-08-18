/**
 * Scaffolding system.
 * Reads stub files, replaces placeholders, writes to target directory.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const stubsDir = resolve(__dirname, '../../stubs')

/**
 * Generate a file from a stub template
 *
 * @param {string} stubName - Name of stub file (without .stub extension)
 * @param {string} targetPath - Where to write the generated file
 * @param {Object} replacements - Key-value pairs for placeholder replacement
 */
export function generate(stubName, targetPath, replacements = {}) {
  const stubPath = join(stubsDir, `${stubName}.stub`)

  if (!existsSync(stubPath)) {
    throw new Error(`Stub not found: ${stubName}.stub`)
  }

  // Check if target already exists
  const fullTargetPath = resolve(process.cwd(), targetPath)
  if (existsSync(fullTargetPath)) {
    throw new Error(`File already exists: ${targetPath}`)
  }

  // Read stub
  let content = readFileSync(stubPath, 'utf8')

  // Replace placeholders: {{name}}, {{Name}}, {{table}}, etc.
  for (const [key, value] of Object.entries(replacements)) {
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g')
    content = content.replace(pattern, value)
  }

  // Ensure directory exists
  const targetDir = dirname(fullTargetPath)
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true })
  }

  // Write file
  writeFileSync(fullTargetPath, content)

  return fullTargetPath
}

/**
 * Transform name to different cases
 */
export function transformName(name) {
  // Remove common suffixes if present
  const baseName = name
    .replace(/Controller$/i, '')
    .replace(/Model$/i, '')
    .replace(/Middleware$/i, '')

  return {
    // Original input
    original: name,

    // PascalCase: UserController
    pascal: toPascalCase(baseName),

    // camelCase: userController
    camel: toCamelCase(baseName),

    // snake_case: user_controller
    snake: toSnakeCase(baseName),

    // kebab-case: user-controller
    kebab: toKebabCase(baseName),

    // lowercase: user
    lower: baseName.toLowerCase(),

    // Plural forms (simple)
    pluralLower: pluralize(baseName.toLowerCase()),
    pluralSnake: pluralize(toSnakeCase(baseName))
  }
}

/**
 * Convert to PascalCase
 */
function toPascalCase(str) {
  return str
    .replace(/[-_\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : '')
    .replace(/^(.)/, (c) => c.toUpperCase())
}

/**
 * Convert to camelCase
 */
function toCamelCase(str) {
  const pascal = toPascalCase(str)
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

/**
 * Convert to snake_case
 */
function toSnakeCase(str) {
  return str
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '')
    .replace(/[-\s]+/g, '_')
}

/**
 * Convert to kebab-case
 */
function toKebabCase(str) {
  return toSnakeCase(str).replace(/_/g, '-')
}

/**
 * Simple pluralization
 */
function pluralize(str) {
  if (str.endsWith('y')) {
    return str.slice(0, -1) + 'ies'
  }
  if (str.endsWith('s') || str.endsWith('x') || str.endsWith('ch') || str.endsWith('sh')) {
    return str + 'es'
  }
  return str + 's'
}

/**
 * Generate timestamp for migration files
 */
export function timestamp() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')

  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join('')
}
