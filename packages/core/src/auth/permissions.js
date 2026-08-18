/**
 * Roles and capabilities.
 *
 * Capability names are `resource.action`. A role may also hold the `.own`
 * variant of an action, which grants it only for records the user owns —
 * `post.edit` means "edit any post", `post.edit.own` means "edit your own".
 *
 * Checks read the role from the request user, which comes from the JWT. A role
 * change therefore does not take effect until the user's token is reissued.
 * Where that matters, reload the user and pass the fresh record to `can()`.
 */

export const ROLES = {
  ADMIN: 'admin',
  EDITOR: 'editor',
  AUTHOR: 'author',
  CONTRIBUTOR: 'contributor',
  SUBSCRIBER: 'subscriber'
}

export const DEFAULT_ROLE = ROLES.SUBSCRIBER

/** Every capability the framework knows about, for validation and docs. */
export const CAPABILITIES = [
  'post.create', 'post.edit', 'post.edit.own', 'post.publish',
  'post.delete', 'post.delete.own',
  'page.create', 'page.edit', 'page.edit.own', 'page.publish',
  'page.delete', 'page.delete.own',
  'category.manage', 'tag.manage',
  'comment.create', 'comment.moderate',
  'media.upload', 'media.delete', 'media.delete.own',
  'settings.manage', 'plugin.manage', 'update.manage',
  'user.manage'
]

const ROLE_CAPABILITIES = {
  [ROLES.ADMIN]: ['*'],

  [ROLES.EDITOR]: [
    'post.create', 'post.edit', 'post.publish', 'post.delete',
    'page.create', 'page.edit', 'page.publish', 'page.delete',
    'category.manage', 'tag.manage',
    'comment.create', 'comment.moderate',
    'media.upload', 'media.delete'
  ],

  [ROLES.AUTHOR]: [
    'post.create', 'post.edit.own', 'post.publish', 'post.delete.own',
    'comment.create',
    'media.upload', 'media.delete.own'
  ],

  // Can write drafts but not publish them, and cannot upload media
  [ROLES.CONTRIBUTOR]: [
    'post.create', 'post.edit.own', 'post.delete.own',
    'comment.create'
  ],

  [ROLES.SUBSCRIBER]: [
    'comment.create'
  ]
}

/**
 * Is this a role we recognise?
 *
 * @param {string} role
 * @returns {boolean}
 */
export function isValidRole(role) {
  return Object.values(ROLES).includes(role)
}

/**
 * All capabilities held by a role.
 *
 * @param {string} role
 * @returns {string[]}
 */
export function capabilitiesFor(role) {
  return ROLE_CAPABILITIES[role] || []
}

/**
 * What an account may still do before it has confirmed its address.
 *
 * Enough to see who they are and ask for another verification mail, and nothing
 * else. Deliberately not "no access at all" — letting the request through means
 * the interface can explain the problem rather than showing a bare error.
 */
export const UNVERIFIED_CAPABILITIES = [
  'profile.view',
  'profile.edit',
  'verification.resend'
]

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
export function isVerified(user) {
  const flag = user?.email_verified
  if (flag === undefined || flag === null) return true
  return flag !== false && flag !== 0
}

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
export function can(user, capability, resource = null) {
  if (!user || !user.role) return false

  // An unverified address holds almost nothing, regardless of role — otherwise
  // anyone could sign up as the first user and be an unverified admin.
  if (!isVerified(user) && !UNVERIFIED_CAPABILITIES.includes(capability)) {
    return false
  }

  const held = capabilitiesFor(user.role)
  if (held.includes('*')) return true
  if (held.includes(capability)) return true

  // Fall back to the ownership-scoped variant
  const ownCapability = `${capability}.own`
  if (held.includes(ownCapability) && resource) {
    const ownerId = resource.user_id ?? resource.author_id ?? resource.userId
    if (ownerId !== undefined && ownerId !== null && String(ownerId) === String(user.id)) {
      return true
    }
  }

  return false
}

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
export function requireCapability(capability, options = {}) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.json({ error: 'Unauthorized' }, 401)
    }

    let resource = null
    if (options.loadResource) {
      resource = await options.loadResource(req)
      if (!resource) {
        return res.json({ error: 'Not found' }, 404)
      }
      req.resource = resource
    }

    if (!can(req.user, capability, resource)) {
      return res.json({ error: 'Forbidden' }, 403)
    }

    next()
  }
}

/**
 * Middleware requiring one of the given roles.
 *
 * Prefer requireCapability — it survives a change to the role table.
 *
 * @param {...string} roles
 * @returns {Function} middleware
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.json({ error: 'Unauthorized' }, 401)
    }
    if (!roles.includes(req.user.role)) {
      return res.json({ error: 'Forbidden' }, 403)
    }
    next()
  }
}

/**
 * Middleware for the admin area.
 *
 * Anyone who can manage some part of the site may reach it; individual routes
 * still gate their own actions.
 *
 * @returns {Function} middleware
 */
export function requireAdminArea() {
  return (req, res, next) => {
    if (!req.user) {
      return res.json({ error: 'Unauthorized' }, 401)
    }
    if (capabilitiesFor(req.user.role).length === 0 || req.user.role === ROLES.SUBSCRIBER) {
      return res.json({ error: 'Forbidden' }, 403)
    }
    next()
  }
}
