/**
 * Validate an upload before signing anything.
 *
 * This is the enforcement point: a caller with no signed URL cannot upload at
 * all, so refusing here is cheaper and more reliable than inspecting bytes
 * afterwards.
 *
 * @param {Object} upload
 * @param {string} upload.filename
 * @param {string} upload.contentType
 * @param {number} upload.size
 * @param {Object} [options]
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateUpload({ filename, contentType, size }?: {
    filename: string;
    contentType: string;
    size: number;
}, options?: any): {
    valid: boolean;
    error?: string;
};
/**
 * Issue a presigned upload URL.
 *
 * @param {Object} upload
 * @param {string} upload.filename
 * @param {string} upload.contentType
 * @param {number} upload.size
 * @param {number|string} [upload.userId] - bound into the ticket
 * @param {Object} [options]
 * @param {number} [options.expiresIn] - seconds
 * @param {string} [options.prefix]
 * @param {number} [options.maxSize]
 * @param {string[]} [options.allowedTypes]
 * @param {string} [options.secret]
 * @param {Object} [options.storage]
 * @returns {Promise<{ ok: boolean, error?: string, uploadUrl?: string, key?: string, ticket?: string, expiresAt?: string }>}
 */
export function signUpload(upload: {
    filename: string;
    contentType: string;
    size: number;
    userId?: number | string;
}, options?: {
    expiresIn?: number;
    prefix?: string;
    maxSize?: number;
    allowedTypes?: string[];
    secret?: string;
    storage?: any;
}): Promise<{
    ok: boolean;
    error?: string;
    uploadUrl?: string;
    key?: string;
    ticket?: string;
    expiresAt?: string;
}>;
/**
 * Verify an upload actually happened, and is what it claimed to be.
 *
 * Everything here is checked against the bucket rather than against what the
 * caller says, because by this point the caller has been to the bucket and back
 * and every field it returns is attacker-controlled.
 *
 * @param {Object} confirmation
 * @param {string} confirmation.key
 * @param {string} confirmation.ticket
 * @param {number|string} [confirmation.userId]
 * @param {Object} [options]
 * @returns {Promise<{ ok: boolean, error?: string, key?: string, size?: number, contentType?: string, url?: string }>}
 */
export function confirmUpload({ key, ticket, userId }?: {
    key: string;
    ticket: string;
    userId?: number | string;
}, options?: any): Promise<{
    ok: boolean;
    error?: string;
    key?: string;
    size?: number;
    contentType?: string;
    url?: string;
}>;
/**
 * Remove an object and announce it.
 *
 * @param {string} key
 * @param {Object} [options]
 * @returns {Promise<void>}
 */
export function deleteUpload(key: string, options?: any): Promise<void>;
/**
 * Check an upload ticket.
 *
 * @returns {{ valid: boolean, reason?: string }}
 */
export function verifyTicket({ key, userId, ticket, secret }: {
    key: any;
    userId: any;
    ticket: any;
    secret: any;
}): {
    valid: boolean;
    reason?: string;
};
/** Types accepted by default. */
export const DEFAULT_ALLOWED_TYPES: string[];
