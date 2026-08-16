import { AdminController } from '../../controllers/AdminController'
import { auth } from '../../middleware/auth'
import { requireCapability } from '@basicbenframework/core/auth/permissions'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
  post: (path: string, ...handlers: Function[]) => void
}

export default (router: Router) => {
  // The admin UI asks the server what to render, because that is the realm
  // plugins are loaded into — a hook fired in the browser would consult an
  // empty registry.
  router.get('/api/admin/menu', auth, AdminController.menu)
  router.get('/api/admin/dashboard', auth, requireCapability('post.edit'), AdminController.dashboard)
  router.post('/api/admin/init', auth, AdminController.init)
}
