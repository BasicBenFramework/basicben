import { verifyJwt } from '@basicbenframework/core/auth'
import { DEFAULT_ROLE } from '@basicbenframework/core/auth/permissions'

// Named export only, deliberately. The framework applies any DEFAULT export from
// src/middleware/*.js to every route, which would 401 the whole site including
// the login endpoint.
export const auth = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) {
    return res.json({ error: 'Unauthorized' }, 401)
  }

  const payload = verifyJwt(token, process.env.APP_KEY)
  if (!payload) {
    return res.json({ error: 'Invalid token' }, 401)
  }

  req.userId = payload.userId
  // Capability checks read req.user. The role comes from the token, so a role
  // change takes effect when the token is reissued.
  req.user = { id: payload.userId, role: payload.role ?? DEFAULT_ROLE }
  next()
}
