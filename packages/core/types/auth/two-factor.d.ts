/**
 * Generate recovery codes.
 *
 * Returned in plaintext exactly once. Hyphenated because they are meant to be
 * written down, and a run of ten characters is easy to lose your place in.
 *
 * @param {number} [count]
 * @returns {string[]}
 */
export function generateRecoveryCodes(count?: number): string[];
/**
 * Hash recovery codes for storage.
 *
 * scrypt, unlike the URL-safe tokens in `tokens.js`. These are short and
 * human-transcribed, so their entropy is low enough that a fast hash would let
 * a leaked table be brute-forced offline.
 *
 * @param {string[]} codes
 * @returns {Promise<string[]>}
 */
export function hashRecoveryCodes(codes: string[]): Promise<string[]>;
/**
 * Check a submitted recovery code against the stored hashes.
 *
 * Returns the index of the code that matched so the caller can consume it — a
 * recovery code is single use.
 *
 * @param {string} submitted
 * @param {string[]} hashes
 * @returns {Promise<number>} index, or -1
 */
export function findRecoveryCode(submitted: string, hashes?: string[]): Promise<number>;
/**
 * Accept a code however the user typed it.
 *
 * @param {string} code
 * @returns {string}
 */
export function normalizeCode(code: string): string;
/**
 * Whether a second factor is currently locked out.
 *
 * @param {Object} record - carries locked_until
 * @param {number} [now]
 * @returns {{ locked: boolean, until: Date|null, retryAfter: number }}
 */
export function lockoutState(record: any, now?: number): {
    locked: boolean;
    until: Date | null;
    retryAfter: number;
};
/**
 * Work out the new attempt state after a failure.
 *
 * Returned rather than written, so the caller owns the storage — the framework
 * has no opinion about where a project keeps this.
 *
 * @param {Object} record - carries failed_attempts
 * @param {Object} [options]
 * @returns {{ failedAttempts: number, lockedUntil: string|null, locked: boolean }}
 */
export function registerFailure(record: any, options?: any): {
    failedAttempts: number;
    lockedUntil: string | null;
    locked: boolean;
};
/**
 * Compare two secrets without leaking their contents through timing.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function safeEquals(a: string, b: string): boolean;
export const RECOVERY_CODE_COUNT: 10;
/** Failures before the second factor locks. */
export const MAX_ATTEMPTS: 5;
/** How long a lock lasts. */
export const LOCKOUT_MS: number;
