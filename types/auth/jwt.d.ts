/**
 * Sign a JWT token
 *
 * @param {Object} payload - Data to encode in the token
 * @param {string} secret - Secret key for signing
 * @param {Object} options - Options (expiresIn)
 * @returns {string} - JWT token
 *
 * @example
 * const token = signJwt({ userId: 1 }, process.env.APP_KEY, { expiresIn: '7d' })
 */
export function signJwt(payload: any, secret: string, options?: any): string;
/**
 * Verify and decode a JWT token
 *
 * @param {string} token - JWT token to verify
 * @param {string} secret - Secret key used for signing
 * @returns {Object|null} - Decoded payload or null if invalid
 *
 * @example
 * const payload = verifyJwt(token, process.env.APP_KEY)
 * if (!payload) {
 *   // Invalid or expired token
 * }
 */
export function verifyJwt(token: string, secret: string): any | null;
/**
 * Decode a JWT token without verification
 * Useful for debugging or reading claims before verification
 *
 * @param {string} token - JWT token
 * @returns {Object|null} - Decoded payload or null if malformed
 */
export function decodeJwt(token: string): any | null;
export { hashPassword, verifyPassword, needsRehash } from "./password.js";
