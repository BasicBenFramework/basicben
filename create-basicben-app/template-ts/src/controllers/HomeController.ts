/**
 * Home Controller
 *
 * Handles basic application endpoints.
 */

import type { Request, Response } from '../types'

export const HomeController = {
  /**
   * Hello endpoint
   */
  hello: async (req: Request, res: Response) => {
    res.json({
      message: 'Welcome to BasicBen!',
      timestamp: new Date().toISOString()
    })
  }
}
