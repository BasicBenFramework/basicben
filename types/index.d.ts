/** @type {string} */
export const VERSION: string;
export { db, query, getDb, QueryBuilder, Grammar } from "./db/index.js";
export { hooks, HookManager, HOOKS } from "./hooks/index.js";
export { plugins, PluginManager } from "./plugins/index.js";
export { loadPlugins, scanPlugins, loadEnabledPlugins, saveEnabledPlugins } from "./plugins/loader.js";
export { parseVersion, compareVersions, isNewer, isOlder, isEqual, satisfies, getChannel, incrementVersion } from "./version.js";
export { createLimiter, rateLimit, parseDuration, clientAddress, MemoryStore, DatabaseStore } from "./server/rate-limit.js";
export { sendMail, consoleTransport, httpTransport, smtpTransport, resendTransport, renderMail, resolveTransport, resetMailer } from "./mail/index.js";
export { issueToken, redeemToken, revokeTokens, hasRecentToken, pruneExpiredTokens, TOKEN_KINDS } from "./auth/tokens.js";
export { generateSecret, totp, hotp, verifyTotp, otpauthUri, encryptSecret, decryptSecret, TOTP_DEFAULTS } from "./auth/totp.js";
export { generateRecoveryCodes, hashRecoveryCodes, findRecoveryCode, lockoutState, registerFailure, MAX_ATTEMPTS, LOCKOUT_MS, RECOVERY_CODE_COUNT } from "./auth/two-factor.js";
export { encodeBase32, decodeBase32 } from "./auth/base32.js";
export { generateRegistrationOptions, generateAuthenticationOptions, verifyRegistration, verifyAuthentication } from "./auth/webauthn/index.js";
export { ROLES, DEFAULT_ROLE, CAPABILITIES, can, capabilitiesFor, isValidRole, requireCapability, requireRole, requireAdminArea, isVerified, UNVERIFIED_CAPABILITIES } from "./auth/permissions.js";
export { getEnvironment, isCloud, isSelfHosted, getVersion } from "./server/environment.js";
