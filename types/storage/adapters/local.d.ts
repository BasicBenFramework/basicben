/**
 * @param {Object} config
 * @param {string} [config.dir] - where files are written
 * @param {string} [config.baseUrl] - URL prefix the files are served under
 * @param {string} [config.secret] - HMAC key for signed URLs
 * @returns {Object} storage adapter
 */
export function createLocalAdapter(config?: {
    dir?: string;
    baseUrl?: string;
    secret?: string;
}): any;
