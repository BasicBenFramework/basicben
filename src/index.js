/**
 * BasicBen framework public API
 */

import pkg from '../package.json' with { type: 'json' }

export const VERSION = pkg.version

// Database
export { db, query, getDb, QueryBuilder, Grammar } from './db/index.js'

// Hooks & Plugins
export { hooks, HookManager, HOOKS } from './hooks/index.js'
export { plugins, PluginManager } from './plugins/index.js'
export { loadPlugins, scanPlugins } from './plugins/loader.js'

// Themes
export { themes, ThemeManager } from './themes/index.js'
export { loadThemes, scanThemes, getThemeStylePath } from './themes/loader.js'

// Updates
export { updates, UpdateManager, RegistryClient } from './updates/index.js'
export {
  parseVersion,
  compareVersions,
  isNewer,
  isOlder,
  isEqual,
  satisfies,
  getChannel,
  incrementVersion
} from './updates/version.js'

// Roles & permissions
export {
  ROLES,
  DEFAULT_ROLE,
  CAPABILITIES,
  can,
  capabilitiesFor,
  isValidRole,
  requireCapability,
  requireRole,
  requireAdminArea
} from './auth/permissions.js'

// Environment
export {
  getEnvironment,
  isCloud,
  isSelfHosted,
  getVersion,
  canManualUpdate,
  getUpdateChannel,
  getLicenseKey
} from './server/environment.js'

// These will be implemented in later phases
// export { validate, rules } from './validation/index.js'
// export { signJwt, verifyJwt } from './auth/jwt.js'
