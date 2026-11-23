import { RedirectController } from '../../controllers/RedirectController'
import { auth } from '../../middleware/auth'
import { requireCapability } from '@basicbenframework/core/auth/permissions'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
  post: (path: string, ...handlers: Function[]) => void
  put: (path: string, ...handlers: Function[]) => void
  delete: (path: string, ...handlers: Function[]) => void
}

/**
 * Admin management of redirects. The public map is `/api/v1/redirects`, in
 * v1.ts; applying it is the front end's job, since the CMS is headless.
 */
export default (router: Router) => {
  router.get('/api/redirects', auth, requireCapability('settings.manage'), RedirectController.index)
  router.post('/api/redirects', auth, requireCapability('settings.manage'), RedirectController.store)
  router.put('/api/redirects/:id', auth, requireCapability('settings.manage'), RedirectController.update)
  router.delete('/api/redirects/:id', auth, requireCapability('settings.manage'), RedirectController.destroy)
}
