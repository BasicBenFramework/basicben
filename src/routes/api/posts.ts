import { PostController } from '../../controllers/PostController'
import { PostLockController } from '../../controllers/PostLockController'
import { auth } from '../../middleware/auth'
import { authOrToken, requireSession } from '../../middleware/api-auth'
import { requireCapability } from '@basicbenframework/core/auth/permissions'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
  post: (path: string, ...handlers: Function[]) => void
  put: (path: string, ...handlers: Function[]) => void
  delete: (path: string, ...handlers: Function[]) => void
}

// The Admin API. These routes take a session or an API token holding
// content:write; with a token the request acts as the token's owner, so every
// capability check below still applies. See docs/admin-api.md. Routes still on
// plain `auth` (bulk, revisions, restore, locks) are for people in the admin
// and refuse tokens.
const contentWrite = authOrToken('content:write')

export default (router: Router) => {
  // Public feed routes
  router.get('/api/feed', PostController.feed)
  router.get('/api/feed/:id', PostController.feedShow)

  // Authenticated post routes. Reading is here too so a program that writes a
  // post can read its draft back; content:read tokens are for /api/v1.
  router.get('/api/posts', contentWrite, PostController.index)
  // Creating is a capability, not just a session: a subscriber has an account
  // and must not be able to write to the site with it.
  router.post('/api/posts', contentWrite, requireCapability('post.create'), PostController.store)
  // Before the /:id routes, which would otherwise read `bulk` as an id.
  router.post('/api/posts/bulk', auth, PostController.bulk)
  router.get('/api/posts/:id', contentWrite, PostController.show)
  router.post('/api/posts/:id/restore', auth, PostController.restore)
  router.put('/api/posts/:id/autosave', auth, PostController.autosave)
  router.get('/api/posts/:id/revisions', auth, PostController.revisions)
  router.get('/api/posts/:id/revisions/:revisionId', auth, PostController.revision)
  router.post('/api/posts/:id/revisions/:revisionId/restore', auth, PostController.restoreRevision)
  // The editor's soft lock: heartbeat, look, let go. A person's, never a
  // token's — `auth` refuses tokens, and requireSession is the second latch.
  router.get('/api/posts/:id/lock', auth, requireSession, PostLockController.show)
  router.post('/api/posts/:id/lock', auth, requireSession, PostLockController.acquire)
  router.delete('/api/posts/:id/lock', auth, requireSession, PostLockController.release)
  router.put('/api/posts/:id', contentWrite, PostController.update)
  // Moves to the trash; on a post already there, deletes it for good — the
  // second only with a session, which the controller checks.
  router.delete('/api/posts/:id', contentWrite, PostController.destroy)
}
