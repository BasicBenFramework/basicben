/**
 * Is this a role we recognise?
 *
 * @param {string} role
 * @returns {boolean}
 */
export function isValidRole(role: string): boolean;
/**
 * All capabilities held by a role.
 *
 * @param {string} role
 * @returns {string[]}
 */
export function capabilitiesFor(role: string): string[];
/**
 * Has this user confirmed their email address?
 *
 * Absent means yes. The flag arrives from the JWT, and a token issued before
 * verification existed carries no such claim — treating that as unverified
 * would lock out every already-signed-in user on deploy.
 *
 * @param {Object} user
 * @returns {boolean}
 */
export function isVerified(user: any): boolean;
/**
 * Can this user perform this capability?
 *
 * Pass the record being acted on as `resource` to allow `.own` capabilities;
 * ownership is read from `user_id`, `author_id`, or `userId`.
 *
 * @param {Object|null} user - must carry `role`, and `id` for ownership checks
 * @param {string} capability - e.g. 'post.edit'
 * @param {Object|null} resource - the record being acted on
 * @returns {boolean}
 */
export function can(user: any | null, capability: string, resource?: any | null): boolean;
/**
 * Middleware requiring a capability.
 *
 * Reads `req.user`, which the auth middleware is expected to populate. For
 * ownership-scoped capabilities pass a `loadResource` that returns the record.
 *
 * @param {string} capability
 * @param {Object} [options]
 * @param {(req: Object) => Promise<Object|null>} [options.loadResource]
 * @returns {Function} middleware
 */
export function requireCapability(capability: string, options?: {
    loadResource?: (req: any) => Promise<any | null>;
}): Function;
/**
 * Middleware requiring one of the given roles.
 *
 * Prefer requireCapability — it survives a change to the role table.
 *
 * @param {...string} roles
 * @returns {Function} middleware
 */
export function requireRole(...roles: string[]): Function;
/**
 * Middleware for the admin area.
 *
 * Anyone who can manage some part of the site may reach it; individual routes
 * still gate their own actions.
 *
 * @returns {Function} middleware
 */
export function requireAdminArea(): Function;
export namespace ROLES {
    let ADMIN: string;
    let EDITOR: string;
    let AUTHOR: string;
    let CONTRIBUTOR: string;
    let SUBSCRIBER: string;
}
export const DEFAULT_ROLE: string;
/** Every capability the framework knows about, for validation and docs. */
export const CAPABILITIES: string[];
/**
 * What an account may still do before it has confirmed its address.
 *
 * Enough to see who they are and ask for another verification mail, and nothing
 * else. Deliberately not "no access at all" — letting the request through means
 * the interface can explain the problem rather than showing a bare error.
 */
export const UNVERIFIED_CAPABILITIES: string[];
