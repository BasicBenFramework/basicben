/**
 * Environment detection for BasicBen
 * Detects if running in cloud or self-hosted mode
 */

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Get package version at module load time
let packageVersion = 'unknown'
try {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const pkgPath = join(__dirname, '../../package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
  packageVersion = pkg.version
} catch {
  // Version will remain 'unknown'
}

/**
 * Get the current environment configuration
 * @returns {object} Environment info
 */
export function getEnvironment() {
  return {
    // Deployment mode
    isCloud: isCloud(),
    isSelfHosted: !isCloud(),

    // Cloud-specific
    tenantId: process.env.BASICBEN_TENANT_ID || null,
    region: process.env.BASICBEN_REGION || null,

    // Version info
    version: process.env.BASICBEN_VERSION || packageVersion,

    // Runtime
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,

    // Environment
    isDevelopment: process.env.NODE_ENV === 'development',
    isProduction: process.env.NODE_ENV === 'production',
    isTest: process.env.NODE_ENV === 'test'
  }
}

/**
 * Check if running in BasicBen Cloud
 * @returns {boolean}
 */
export function isCloud() {
  return process.env.BASICBEN_CLOUD === 'true'
}

/**
 * Check if running in self-hosted mode
 * @returns {boolean}
 */
export function isSelfHosted() {
  return !isCloud()
}

/**
 * Get the tenant ID (cloud only)
 * @returns {string|null}
 */
export function getTenantId() {
  return process.env.BASICBEN_TENANT_ID || null
}

/**
 * Get the deployment region (cloud only)
 * @returns {string|null}
 */
export function getRegion() {
  return process.env.BASICBEN_REGION || null
}

/**
 * Get the current BasicBen version
 * @returns {string}
 */
export function getVersion() {
  return process.env.BASICBEN_VERSION || packageVersion
}

/**
 * Assert that running in cloud mode
 * @throws {Error} If running in self-hosted mode
 */
export function assertCloud() {
  if (!isCloud()) {
    throw new Error('This operation is only available on BasicBen Cloud.')
  }
}
