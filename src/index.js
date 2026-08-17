/**
 * BasicBen framework public API
 */

import pkg from '../package.json' with { type: 'json' }

/** @type {string} */
export const VERSION = pkg.version

// Database
export { db, query, getDb, QueryBuilder, Grammar } from './db/index.js'

// Hooks & Plugins
export { hooks, HookManager, HOOKS } from './hooks/index.js'
export { plugins, PluginManager } from './plugins/index.js'
export { loadPlugins, scanPlugins, loadEnabledPlugins, saveEnabledPlugins } from './plugins/loader.js'

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

// Rate limiting
export {
  createLimiter,
  rateLimit,
  parseDuration,
  clientAddress,
  MemoryStore,
  DatabaseStore
} from './server/rate-limit.js'

// Mail
export {
  sendMail,
  consoleTransport,
  httpTransport,
  smtpTransport,
  resendTransport,
  renderMail,
  resolveTransport,
  resetMailer
} from './mail/index.js'

// Short-lived credentials
export {
  issueToken,
  redeemToken,
  revokeTokens,
  hasRecentToken,
  pruneExpiredTokens,
  TOKEN_KINDS
} from './auth/tokens.js'

// Two-factor authentication
export {
  generateSecret,
  totp,
  hotp,
  verifyTotp,
  otpauthUri,
  encryptSecret,
  decryptSecret,
  TOTP_DEFAULTS
} from './auth/totp.js'

export {
  generateRecoveryCodes,
  hashRecoveryCodes,
  findRecoveryCode,
  lockoutState,
  registerFailure,
  MAX_ATTEMPTS,
  LOCKOUT_MS,
  RECOVERY_CODE_COUNT
} from './auth/two-factor.js'

export { encodeBase32, decodeBase32 } from './auth/base32.js'

// Passkeys (WebAuthn). Attestation is not verified — see the module docs.
export {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistration,
  verifyAuthentication
} from './auth/webauthn/index.js'

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
  requireAdminArea,
  isVerified,
  UNVERIFIED_CAPABILITIES
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
