import { PostController } from '../../controllers/PostController'
import { auth } from '../../middleware/auth'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
  post: (path: string, ...handlers: Function[]) => void
  put: (path: string, ...handlers: Function[]) => void
  delete: (path: string, ...handlers: Function[]) => void
}

export default (router: Router) => {
  // Public feed routes
  router.get('/api/feed', PostController.feed)
  router.get('/api/feed/:id', PostController.feedShow)

  // Authenticated post routes
  router.get('/api/posts', auth, PostController.index)
  router.post('/api/posts', auth, PostController.store)
  router.get('/api/posts/:id', auth, PostController.show)
  router.put('/api/posts/:id', auth, PostController.update)
  router.delete('/api/posts/:id', auth, PostController.destroy)
}
