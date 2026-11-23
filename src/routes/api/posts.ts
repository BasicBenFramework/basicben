import { PostController } from '../../controllers/PostController'
import { auth } from '../../middleware/auth'
import { requireCapability } from '@basicbenframework/core/auth/permissions'

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
  // Creating is a capability, not just a session: a subscriber has an account
  // and must not be able to write to the site with it.
  router.post('/api/posts', auth, requireCapability('post.create'), PostController.store)
  // Before the /:id routes, which would otherwise read `bulk` as an id.
  router.post('/api/posts/bulk', auth, PostController.bulk)
  router.get('/api/posts/:id', auth, PostController.show)
  router.post('/api/posts/:id/restore', auth, PostController.restore)
  router.put('/api/posts/:id/autosave', auth, PostController.autosave)
  router.get('/api/posts/:id/revisions', auth, PostController.revisions)
  router.get('/api/posts/:id/revisions/:revisionId', auth, PostController.revision)
  router.post('/api/posts/:id/revisions/:revisionId/restore', auth, PostController.restoreRevision)
  router.put('/api/posts/:id', auth, PostController.update)
  // Moves to the trash; on a post already there, deletes it for good.
  router.delete('/api/posts/:id', auth, PostController.destroy)
}
