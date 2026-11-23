import { CommentController } from '../../controllers/CommentController'
import { auth, optionalAuth } from '../../middleware/auth'
import { commentLimit } from '../../middleware/rate-limits'
import { requireCapability } from '@basicbenframework/core/auth/permissions'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
  post: (path: string, ...handlers: Function[]) => void
  put: (path: string, ...handlers: Function[]) => void
  delete: (path: string, ...handlers: Function[]) => void
}

export default (router: Router) => {
  // Public routes - get comments for a post
  // optionalAuth so a moderator can ask for the whole thread; everyone else
  // gets the approved comments, without addresses.
  router.get('/api/posts/:postId/comments', optionalAuth, CommentController.byPost)

  // Post comment (optional auth - guests can comment with name/email)
  // optionalAuth so a signed-in commenter posts as themselves. This route
  // never ran any auth, so everyone was a guest and could use any name.
  router.post('/api/posts/:postId/comments', commentLimit, optionalAuth, CommentController.store)

  // Admin routes (authenticated)
  router.get('/api/comments', auth, requireCapability('comment.moderate'), CommentController.index)
  router.get('/api/comments/pending', auth, requireCapability('comment.moderate'), CommentController.pending)
  router.get('/api/comments/:id', auth, requireCapability('comment.moderate'), CommentController.show)
  router.put('/api/comments/:id', auth, requireCapability('comment.moderate'), CommentController.update)
  router.put('/api/comments/:id/approve', auth, requireCapability('comment.moderate'), CommentController.approve)
  router.delete('/api/comments/:id', auth, requireCapability('comment.moderate'), CommentController.destroy)
}
