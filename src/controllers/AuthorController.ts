/**
 * Who a post can be attributed to.
 *
 * The editor needs a list of people before it can offer an Author menu, and
 * that list is not "every user": a subscriber has an account so they can
 * comment, and putting them in a byline menu invites a post attributed to
 * someone who cannot write one. `User.authors()` filters by capability instead
 * of by role name, so the answer stays right when the role table changes.
 *
 * Reading the list needs `post.create` — you have to be able to write before
 * the question is meaningful. Actually reassigning a post needs `post.edit`,
 * which `PostController` enforces on the write.
 */

import { User } from '../models/User'
import type { Request, Response } from '../types'

export const AuthorController = {
  async index(_req: Request, res: Response) {
    res.json({ authors: await User.authors() })
  }
}
