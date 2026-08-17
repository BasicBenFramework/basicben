import { verifyJwt } from '@basicbenframework/core/auth'
import { DEFAULT_ROLE } from '@basicbenframework/core/auth/permissions'
import { isApiToken } from '@basicbenframework/core/auth/api-tokens'
import type { Request, Response } from '../types'

interface JwtPayload {
  userId: number
  role?: string
  email_verified?: boolean
}

// Named export only, deliberately. The framework applies any DEFAULT export from
// src/middleware/*.js to every route, which would 401 the whole site including
// the login endpoint.
export const auth = async (req: Request, res: Response, next: () => void) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) {
    return res.json({ error: 'Unauthorized' }, 401)
  }

  // An API token can never verify as a JWT, so this middleware already refuses
  // one — but "Invalid token" for a credential that is perfectly valid
  // elsewhere reads as a bug in the token rather than a rule about this route.
  if (isApiToken(token)) {
    return res.json(
      {
        error: 'This endpoint requires a signed-in session, not an API token',
        hint: 'API tokens work on /api/v1/*. Managing them requires logging in.'
      },
      403
    )
  }

  const payload = verifyJwt(token, process.env.APP_KEY as string) as JwtPayload | null
  if (!payload) {
    return res.json({ error: 'Invalid token' }, 401)
  }

  req.userId = payload.userId
  // Capability checks read req.user. The role comes from the token, so a role
  // change takes effect when the token is reissued.
  req.user = {
    id: payload.userId,
    role: payload.role ?? DEFAULT_ROLE,
    // Absent means verified: a token issued before this feature existed carries
    // no such claim, and treating that as unverified would lock everyone out.
    email_verified: payload.email_verified ?? true
  }
  next()
}
