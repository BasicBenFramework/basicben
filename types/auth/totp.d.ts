/**
 * Generate a random secret.
 *
 * Twenty bytes is the RFC 4226 recommendation and matches the HMAC-SHA1 block
 * behaviour; longer buys nothing here.
 *
 * @param {number} [bytes]
 * @returns {string} base32
 */
export function generateSecret(bytes?: number): string;
/**
 * Compute the code for a moment in time.
 *
 * @param {string} secret - base32
 * @param {Object} [options]
 * @param {number} [options.t] - unix seconds; defaults to now
 * @param {number} [options.step]
 * @param {number} [options.digits]
 * @param {string} [options.algorithm]
 * @returns {string} zero-padded code
 */
export function totp(secret: string, options?: {
    t?: number;
    step?: number;
    digits?: number;
    algorithm?: string;
}): string;
/**
 * Compute the code for a counter value (HOTP).
 *
 * @param {string} secret - base32
 * @param {number} counter
 * @param {Object} [options]
 * @returns {string}
 */
export function hotp(secret: string, counter: number, options?: any): string;
/**
 * Verify a submitted code.
 *
 * Returns the time step the code matched, which the caller must persist: a code
 * stays valid for its whole 30-second window, so without recording the step an
 * intercepted code can be replayed within it.
 *
 * @param {string} secret - base32
 * @param {string} code
 * @param {Object} [options]
 * @param {number} [options.window] - steps of tolerance either side
 * @param {number|null} [options.lastStep] - the most recent accepted step;
 *   null or undefined both mean "none recorded yet"
 * @param {number} [options.t]
 * @param {number} [options.digits]
 * @param {number} [options.step]
 * @returns {{ valid: boolean, step: number|null, reason?: string }}
 */
export function verifyTotp(secret: string, code: string, options?: {
    window?: number;
    lastStep?: number | null;
    t?: number;
    digits?: number;
    step?: number;
}): {
    valid: boolean;
    step: number | null;
    reason?: string;
};
/**
 * Build the otpauth:// URI an authenticator app imports.
 *
 * Deliberately no QR code: encoding one is several hundred lines for something
 * the client can render, and it keeps the secret out of any image the server
 * generates and might cache.
 *
 * @param {Object} options
 * @param {string} options.secret - base32
 * @param {string} options.label - usually the account's email
 * @param {string} [options.issuer] - the site name
 * @param {number} [options.digits]
 * @param {number} [options.step] - period, in seconds
 * @param {string} [options.algorithm]
 * @returns {string}
 */
export function otpauthUri({ secret, label, issuer, digits, step, algorithm }?: {
    secret: string;
    label: string;
    issuer?: string;
    digits?: number;
    step?: number;
    algorithm?: string;
}): string;
/**
 * Encrypt a secret for storage.
 *
 * A database leak should not hand over working second factors. AES-256-GCM
 * under a key derived from APP_KEY, which means **rotating APP_KEY invalidates
 * every enrolled secret** — users have to re-enrol, so treat it as a migration
 * rather than a config change.
 *
 * @param {string} secret - base32
 * @param {string} [key] - defaults to APP_KEY
 * @returns {string} iv:tag:ciphertext, base64
 */
export function encryptSecret(secret: string, key?: string): string;
/**
 * Decrypt a stored secret.
 *
 * Returns null rather than throwing when the value cannot be read — a secret
 * encrypted under a previous APP_KEY is indistinguishable from a corrupt one,
 * and the caller's response is the same either way.
 *
 * @param {string} stored
 * @param {string} [key]
 * @returns {string|null}
 */
export function decryptSecret(stored: string, key?: string): string | null;
export namespace TOTP_DEFAULTS {
    let algorithm: string;
    let digits: number;
    let step: number;
    let window: number;
}
