/**
 * Get or create the storage adapter.
 *
 * @returns {Promise<Object>}
 */
export function getStorage(): Promise<any>;
/**
 * Fill in configuration from the environment.
 *
 * The driver defaults to `local` when no bucket is configured, so a fresh
 * project works before anyone has a cloud account.
 *
 * @param {Object} config
 * @returns {Object}
 */
export function resolveConfig(config?: any): any;
/**
 * Reset the memoized adapter. For tests, and for a config reload.
 */
export function resetStorage(): void;
/**
 * Build an adapter directly, bypassing config.
 *
 * @param {Object} config
 * @returns {Promise<Object>}
 */
export function createStorage(config?: any): Promise<any>;
/**
 * Build a storage key for an upload.
 *
 * Keys are date-partitioned and carry random bytes, which does three things:
 * two files called `screenshot.png` do not collide, a caller cannot overwrite
 * someone else's object by guessing a key, and no directory ends up with a
 * hundred thousand entries.
 *
 * @param {string} filename
 * @param {Object} [options]
 * @param {string} [options.prefix]
 * @param {Date} [options.now]
 * @returns {string}
 */
export function buildKey(filename: string, options?: {
    prefix?: string;
    now?: Date;
}): string;
/**
 * Reduce a user-supplied filename to something safe to put in a key.
 *
 * Path separators and traversal sequences are removed rather than escaped:
 * there is no legitimate reason for either in a filename, and keeping them
 * would let an upload choose where it lands.
 *
 * @param {string} filename
 * @returns {string}
 */
export function sanitizeFilename(filename: string): string;
/**
 * Resolve a storage URL into one a consumer somewhere else can fetch.
 *
 * The local driver serves from the app's own origin, so `publicUrl()` hands
 * back `/uploads/...`. That is right for the bundled frontend and useless to a
 * headless consumer: a static build running on another host has nothing to
 * resolve it against, and the markup it emits would point at its own server.
 * The S3 driver already returns an absolute URL, and an absolute URL passes
 * through untouched.
 *
 * The input comes back unchanged when there is no base to resolve against, or
 * when the base is unusable. A relative URL is worse than an absolute one and
 * far better than throwing from inside a read endpoint.
 *
 * @param {string} url - a URL from `publicUrl()`, absolute or app-relative
 * @param {string} [base] - origin to resolve against; defaults to APP_URL
 * @returns {string}
 */
export function absoluteUrl(url: string, base?: string): string;
export { createS3Adapter } from "./adapters/s3.js";
export { createLocalAdapter } from "./adapters/local.js";
export { signRequest, presignUrl, hashPayload, amzDate, UNSIGNED_PAYLOAD, EMPTY_PAYLOAD_HASH } from "./sigv4.js";
