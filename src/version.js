/**
 * Version comparison and parsing utilities
 */

/**
 * Parse a semver version string into components
 * @param {string} version - Version string (e.g., "1.2.3", "1.2.3-beta.1")
 * @returns {object} Parsed version object
 */
export function parseVersion(version) {
  if (!version || typeof version !== 'string') {
    return null
  }

  // Remove leading 'v' if present
  const cleaned = version.replace(/^v/, '')

  // Match semver pattern: major.minor.patch[-prerelease][+build]
  const match = cleaned.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?(?:\+([a-zA-Z0-9.-]+))?$/
  )

  if (!match) {
    return null
  }

  const [, major, minor, patch, prerelease, build] = match

  return {
    major: parseInt(major, 10),
    minor: parseInt(minor, 10),
    patch: parseInt(patch, 10),
    prerelease: prerelease || null,
    build: build || null,
    raw: version
  }
}

/**
 * Compare two version strings
 * @param {string} a - First version
 * @param {string} b - Second version
 * @returns {number} -1 if a < b, 0 if a == b, 1 if a > b
 */
export function compareVersions(a, b) {
  const versionA = parseVersion(a)
  const versionB = parseVersion(b)

  if (!versionA || !versionB) {
    throw new Error(`Invalid version format: ${!versionA ? a : b}`)
  }

  // Compare major.minor.patch
  if (versionA.major !== versionB.major) {
    return versionA.major > versionB.major ? 1 : -1
  }

  if (versionA.minor !== versionB.minor) {
    return versionA.minor > versionB.minor ? 1 : -1
  }

  if (versionA.patch !== versionB.patch) {
    return versionA.patch > versionB.patch ? 1 : -1
  }

  // Handle prerelease versions
  // No prerelease > prerelease (1.0.0 > 1.0.0-beta)
  if (!versionA.prerelease && versionB.prerelease) {
    return 1
  }

  if (versionA.prerelease && !versionB.prerelease) {
    return -1
  }

  if (versionA.prerelease && versionB.prerelease) {
    return comparePrereleases(versionA.prerelease, versionB.prerelease)
  }

  return 0
}

/**
 * Compare prerelease strings
 * @param {string} a - First prerelease
 * @param {string} b - Second prerelease
 * @returns {number} Comparison result
 */
function comparePrereleases(a, b) {
  const partsA = a.split('.')
  const partsB = b.split('.')

  const maxLength = Math.max(partsA.length, partsB.length)

  for (let i = 0; i < maxLength; i++) {
    const partA = partsA[i]
    const partB = partsB[i]

    // Missing part means earlier version
    if (partA === undefined) return -1
    if (partB === undefined) return 1

    // Compare numerically if both are numbers
    const numA = parseInt(partA, 10)
    const numB = parseInt(partB, 10)

    if (!isNaN(numA) && !isNaN(numB)) {
      if (numA !== numB) return numA > numB ? 1 : -1
    } else {
      // Compare as strings
      if (partA !== partB) return partA > partB ? 1 : -1
    }
  }

  return 0
}

/**
 * Check if version A is newer than version B
 * @param {string} a - First version
 * @param {string} b - Second version
 * @returns {boolean} True if a > b
 */
export function isNewer(a, b) {
  return compareVersions(a, b) > 0
}

/**
 * Check if version A is older than version B
 * @param {string} a - First version
 * @param {string} b - Second version
 * @returns {boolean} True if a < b
 */
export function isOlder(a, b) {
  return compareVersions(a, b) < 0
}

/**
 * Check if two versions are equal
 * @param {string} a - First version
 * @param {string} b - Second version
 * @returns {boolean} True if a == b
 */
export function isEqual(a, b) {
  return compareVersions(a, b) === 0
}

/**
 * Check if a version satisfies a requirement
 * Supports: >=, >, <=, <, =, ^, ~
 * @param {string} required - Requirement string (e.g., ">=1.0.0", "^2.0.0")
 * @param {string} current - Version to check
 * @returns {boolean} True if current satisfies required
 */
export function satisfies(required, current) {
  if (!required || !current) {
    return false
  }

  // Parse the requirement
  const match = required.match(/^([>=<^~]*)(.+)$/)
  if (!match) {
    return false
  }

  const [, operator, version] = match
  const op = operator || '='

  const currentParsed = parseVersion(current)
  const requiredParsed = parseVersion(version)

  if (!currentParsed || !requiredParsed) {
    return false
  }

  switch (op) {
    case '=':
    case '==':
      return compareVersions(current, version) === 0

    case '>':
      return compareVersions(current, version) > 0

    case '>=':
      return compareVersions(current, version) >= 0

    case '<':
      return compareVersions(current, version) < 0

    case '<=':
      return compareVersions(current, version) <= 0

    case '^':
      // Compatible with version (same major, >= minor.patch)
      if (currentParsed.major !== requiredParsed.major) {
        return false
      }
      return compareVersions(current, version) >= 0

    case '~':
      // Approximately equivalent (same major.minor, >= patch)
      if (currentParsed.major !== requiredParsed.major) {
        return false
      }
      if (currentParsed.minor !== requiredParsed.minor) {
        return false
      }
      return compareVersions(current, version) >= 0

    default:
      return false
  }
}

/**
 * Get the release channel from a version
 * @param {string} version - Version string
 * @returns {string} Channel: 'stable', 'beta', 'alpha', 'dev', or 'rc'
 */
export function getChannel(version) {
  const parsed = parseVersion(version)

  if (!parsed) {
    return 'unknown'
  }

  if (!parsed.prerelease) {
    return 'stable'
  }

  const prerelease = parsed.prerelease.toLowerCase()

  if (prerelease.includes('alpha')) {
    return 'alpha'
  }

  if (prerelease.includes('beta')) {
    return 'beta'
  }

  if (prerelease.includes('rc')) {
    return 'rc'
  }

  if (prerelease.includes('dev') || prerelease.includes('canary')) {
    return 'dev'
  }

  return 'prerelease'
}

/**
 * Get the next version based on release type
 * @param {string} current - Current version
 * @param {string} type - Release type: 'major', 'minor', 'patch', 'prerelease'
 * @returns {string} Next version
 */
export function incrementVersion(current, type = 'patch') {
  const parsed = parseVersion(current)

  if (!parsed) {
    throw new Error(`Invalid version: ${current}`)
  }

  switch (type) {
    case 'major':
      return `${parsed.major + 1}.0.0`

    case 'minor':
      return `${parsed.major}.${parsed.minor + 1}.0`

    case 'patch':
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`

    case 'prerelease':
      if (parsed.prerelease) {
        // Increment prerelease number
        const match = parsed.prerelease.match(/^(.+?)(\d+)$/)
        if (match) {
          const [, prefix, num] = match
          return `${parsed.major}.${parsed.minor}.${parsed.patch}-${prefix}${parseInt(num, 10) + 1}`
        }
        return `${parsed.major}.${parsed.minor}.${parsed.patch}-${parsed.prerelease}.1`
      }
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}-beta.1`

    default:
      throw new Error(`Unknown release type: ${type}`)
  }
}
