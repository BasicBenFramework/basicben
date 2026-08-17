import {
  createApiToken,
  listApiTokens,
  revokeApiToken,
  SCOPES
} from '@basicbenframework/core/auth/api-tokens'
import { validate, rules } from '@basicbenframework/core/validation'
import type { Request, Response } from '../types'

const ALL_SCOPES = Object.values(SCOPES)

/** Days, converted to the ttl the token store wants. */
const DAY_MS = 24 * 60 * 60 * 1000

export const TokenController = {
  /**
   * A user's own tokens.
   *
   * Always scoped to `req.userId` rather than accepting one, so there is no
   * parameter to tamper with. An admin has no listing of everyone's tokens on
   * purpose: the point of hash-only storage is that nobody, including an admin,
   * can read someone else's credential.
   */
  async index(req: Request, res: Response) {
    res.json({ tokens: await listApiTokens(req.userId!), scopes: ALL_SCOPES })
  },

  /**
   * Issue a token.
   *
   * The plaintext comes back exactly once, in this response, and is never
   * retrievable again — which is the whole point of storing only its hash.
   */
  async store(req: Request, res: Response) {
    const result = await validate(req.body, {
      name: [rules.required, rules.string, rules.min(1)]
    })

    if (result.fails()) {
      return res.json({ errors: result.errors }, 422)
    }

    const { name, scopes, expiresInDays } = req.body as {
      name: string
      scopes?: string[]
      expiresInDays?: number
    }

    if (!Array.isArray(scopes) || scopes.length === 0) {
      return res.json({ errors: { scopes: ['Pick at least one scope'] } }, 422)
    }

    // Days rather than a raw ttl because that is what the form collects, and a
    // number of milliseconds arriving from a client is a number nobody checked.
    let ttl: number | undefined

    if (expiresInDays !== undefined && expiresInDays !== null) {
      const days = Number(expiresInDays)

      if (!Number.isFinite(days) || days <= 0) {
        return res.json({ errors: { expiresInDays: ['Must be a positive number of days'] } }, 422)
      }

      ttl = days * DAY_MS
    }

    try {
      const token = await createApiToken(req.userId!, { name, scopes, ttl })

      res.json(
        {
          // Named `token` and returned only here. The listing endpoint cannot
          // produce it, so a client that discards this value has lost it.
          token: token.token,
          created: {
            id: token.id,
            name: token.name,
            scopes: token.scopes,
            expiresAt: token.expiresAt
          }
        },
        201
      )
    } catch (error) {
      // createApiToken throws on an unknown scope or a blank name, which are
      // both client mistakes rather than server faults.
      return res.json({ errors: { scopes: [(error as Error).message] } }, 422)
    }
  },

  /**
   * Revoke a token.
   *
   * Scoped to the owner in the query itself, so a guessed id belonging to
   * someone else deletes nothing and returns 404 rather than confirming it
   * exists.
   */
  async destroy(req: Request, res: Response) {
    const id = Number(req.params.id)

    if (!Number.isInteger(id)) {
      return res.json({ error: 'Token not found' }, 404)
    }

    const revoked = await revokeApiToken(id, req.userId!)

    if (!revoked) {
      return res.json({ error: 'Token not found' }, 404)
    }

    res.json({ revoked: true })
  }
}
