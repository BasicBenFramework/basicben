/**
 * Middleware accepting PUTs to signed local-storage URLs.
 *
 * @param {Object} [options]
 * @param {string} [options.dir] - where files are written
 * @param {string} [options.baseUrl] - the path prefix these URLs use
 * @param {string} [options.secret] - HMAC key, must match the adapter's
 * @param {number} [options.maxSize] - bytes
 * @param {Object} [options.adapter] - supplies signature verification
 * @returns {Function} middleware
 */
export function localUploadReceiver(options?: {
    dir?: string;
    baseUrl?: string;
    secret?: string;
    maxSize?: number;
    adapter?: any;
}): Function;
