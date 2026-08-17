/**
 * Whether a string looks like an API token rather than a JWT.
 *
 * Used to pick a verifier, not to validate — a string passing this can still be
 * complete nonsense.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isApiToken(value: string): boolean;
/**
 * Whether a set of held scopes grants a required one.
 *
 * @param {string[]} held
 * @param {string} required
 * @returns {boolean}
 */
export function hasScope(held: string[], required: string): boolean;
/**
 * Issue a token and return the plaintext.
 *
 * The plaintext is returned exactly once and never stored. If it is lost, the
 * only remedy is issuing another — which is what every credential store worth
 * using does, and what makes the hash-only storage above meaningful.
 *
 * @param {number} userId
 * @param {Object} options
 * @param {string} options.name - what this token is for, shown in the UI
 * @param {string[]} options.scopes
 * @param {number} [options.ttl] - lifetime in ms; omit for a token that does not expire
 * @returns {Promise<{ token: string, id: number, name: string, scopes: string[], expiresAt: Date|null }>}
 */
export function createApiToken(userId: number, options?: {
    name: string;
    scopes: string[];
    ttl?: number;
}): Promise<{
    token: string;
    id: number;
    name: string;
    scopes: string[];
    expiresAt: Date | null;
}>;
/**
 * Verify a token, optionally requiring a scope.
 *
 * Returns null for anything not currently usable — unknown, expired, or lacking
 * the scope — rather than distinguishing them. The caller is an authentication
 * middleware, and telling an unauthenticated client *why* its credential failed
 * tells an attacker which of their guesses was a real token.
 *
 * @param {string} token
 * @param {string} [requiredScope]
 * @returns {Promise<{ id: number, userId: number, name: string, scopes: string[] }|null>}
 */
export function verifyApiToken(token: string, requiredScope?: string): Promise<{
    id: number;
    userId: number;
    name: string;
    scopes: string[];
} | null>;
/**
 * A user's tokens, without anything secret.
 *
 * There is no way to recover a token's plaintext here, by design — the hash is
 * not returned either, since it is a verifier and handing it out would let a
 * reader of this list authenticate.
 *
 * @param {number} userId
 * @returns {Promise<Array<{ id: number, name: string, scopes: string[], lastUsedAt: string|null, expiresAt: string|null, createdAt: string }>>}
 */
export function listApiTokens(userId: number): Promise<Array<{
    id: number;
    name: string;
    scopes: string[];
    lastUsedAt: string | null;
    expiresAt: string | null;
    createdAt: string;
}>>;
/**
 * Revoke a token.
 *
 * Scoped to the owner so one user cannot revoke another's by guessing an id.
 * The row is deleted rather than flagged: a revoked token has no further use,
 * and a list mixing live and dead credentials is one people stop reading.
 *
 * @param {number} id
 * @param {number} userId
 * @returns {Promise<boolean>} whether a token was revoked
 */
export function revokeApiToken(id: number, userId: number): Promise<boolean>;
/**
 * Revoke every token belonging to a user.
 *
 * @param {number} userId
 * @returns {Promise<number>} rows deleted
 */
export function revokeAllApiTokens(userId: number): Promise<number>;
/**
 * Delete expired tokens.
 *
 * Nothing calls this automatically — there is no scheduler. Expired tokens are
 * refused by `verifyApiToken` regardless; this only keeps the table tidy.
 *
 * @returns {Promise<number>} rows deleted
 */
export function pruneExpiredApiTokens(): Promise<number>;
/**
 * SHA-256 of the token, hex encoded.
 *
 * @param {string} token
 * @returns {string}
 */
export function hashApiToken(token: string): string;
export const TOKEN_PREFIX: "bb_";
export namespace SCOPES {
    let CONTENT_READ: string;
    let CONTENT_WRITE: string;
    let MEDIA_READ: string;
    let MEDIA_WRITE: string;
}
