import { AuthorController } from '../../controllers/AuthorController'
import { auth } from '../../middleware/auth'
import { requireCapability } from '@basicbenframework/core/auth/permissions'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
}

export default (router: Router) => {
  // The admin's author menu. Profiles for a reader come from /api/v1/authors,
  // which is a different surface with a different rule about who may read it.
  router.get('/api/authors', auth, requireCapability('post.create'), AuthorController.index)
}
