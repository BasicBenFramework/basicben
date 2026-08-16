/**
 * Issue a token and return the plaintext.
 *
 * The plaintext is returned exactly once and never stored. If it is lost, the
 * only remedy is issuing another.
 *
 * @param {number} userId
 * @param {string} kind
 * @param {Object} [options]
 * @param {number} [options.ttl] - lifetime in ms
 * @param {Object} [options.metadata] - stored as JSON alongside
 * @returns {Promise<{ token: string, expiresAt: Date }>}
 */
export function issueToken(userId: number, kind: string, options?: {
    ttl?: number;
    metadata?: any;
}): Promise<{
    token: string;
    expiresAt: Date;
}>;
/**
 * Redeem a token, consuming it.
 *
 * Returns null for anything not currently valid — unknown, wrong kind, expired,
 * or already used — rather than distinguishing them, since the caller has no
 * safe use for the difference.
 *
 * @param {string} token
 * @param {string} kind
 * @returns {Promise<{ userId: number, metadata: Object|null }|null>}
 */
export function redeemToken(token: string, kind: string): Promise<{
    userId: number;
    metadata: any | null;
} | null>;
/**
 * Invalidate every outstanding token of a kind for a user.
 *
 * Called when the underlying fact changes — a verified address, a reset
 * password — so an older link cannot still be used.
 *
 * @param {number} userId
 * @param {string} kind
 * @returns {Promise<number>} rows affected
 */
export function revokeTokens(userId: number, kind: string): Promise<number>;
/**
 * Whether a live token was issued recently.
 *
 * The framework has no rate limiter, and resend is an outbound-mail trigger, so
 * the token table doubles as the cooldown — no new infrastructure required.
 *
 * @param {number} userId
 * @param {string} kind
 * @param {number} withinMs
 * @returns {Promise<boolean>}
 */
export function hasRecentToken(userId: number, kind: string, withinMs: number): Promise<boolean>;
/**
 * Delete expired and used tokens.
 *
 * Nothing calls this automatically — there is no scheduler. Run it from a cron
 * or an admin action.
 *
 * @param {Object} [options]
 * @param {number} [options.keepUsedFor] - retain used rows this long, for audit
 * @returns {Promise<number>} rows deleted
 */
export function pruneExpiredTokens(options?: {
    keepUsedFor?: number;
}): Promise<number>;
/**
 * SHA-256 of the token, hex encoded.
 *
 * @param {string} token
 * @returns {string}
 */
export function hashToken(token: string): string;
export namespace TOKEN_KINDS {
    let EMAIL_VERIFICATION: string;
    let PASSWORD_RESET: string;
    let TWO_FACTOR_CHALLENGE: string;
    let WEBAUTHN_CHALLENGE: string;
}
