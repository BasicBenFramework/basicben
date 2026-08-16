/**
 * Hash a password securely
 *
 * @param {string} password - Plain text password
 * @param {Object} options - Optional parameters
 * @returns {Promise<string>} - Hash in format: salt:hash:params
 *
 * @example
 * const hash = await hashPassword('mysecretpassword')
 * // Store hash in database
 */
export function hashPassword(password: string, options?: any): Promise<string>;
/**
 * Verify a password against a hash
 *
 * @param {string} password - Plain text password to verify
 * @param {string} hash - Stored hash from hashPassword()
 * @returns {Promise<boolean>} - True if password matches
 *
 * @example
 * const isValid = await verifyPassword('mysecretpassword', storedHash)
 * if (!isValid) {
 *   // Invalid password
 * }
 */
export function verifyPassword(password: string, hash: string): Promise<boolean>;
/**
 * Check if a hash needs to be rehashed (e.g., cost factor increased)
 *
 * @param {string} hash - Stored hash
 * @param {Object} options - Current desired parameters
 * @returns {boolean} - True if hash should be regenerated
 */
export function needsRehash(hash: string, options?: any): boolean;
