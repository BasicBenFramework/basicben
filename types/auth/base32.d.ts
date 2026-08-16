/**
 * Encode bytes as base32, without padding.
 *
 * @param {Uint8Array|Buffer} bytes
 * @returns {string}
 */
export function encodeBase32(bytes: Uint8Array | Buffer): string;
/**
 * Decode base32 to bytes.
 *
 * Tolerant of what a person actually types: lowercase, padding, and the spaces
 * authenticator apps insert to make a secret readable.
 *
 * @param {string} input
 * @returns {Buffer}
 */
export function decodeBase32(input: string): Buffer;
