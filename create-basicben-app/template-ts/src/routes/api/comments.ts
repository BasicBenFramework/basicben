import { CommentController } from '../../controllers/CommentController'
import { auth } from '../../middleware/auth'
import { requireCapability } from '@basicbenframework/core/auth/permissions'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
  post: (path: string, ...handlers: Function[]) => void
  put: (path: string, ...handlers: Function[]) => void
  delete: (path: string, ...handlers: Function[]) => void
}

export default (router: Router) => {
  // Public routes - get comments for a post
  router.get('/api/posts/:postId/comments', CommentController.byPost)

  // Post comment (optional auth - guests can comment with name/email)
  router.post('/api/posts/:postId/comments', CommentController.store)

  // Admin routes (authenticated)
  router.get('/api/comments', auth, requireCapability('comment.moderate'), CommentController.index)
  router.get('/api/comments/pending', auth, requireCapability('comment.moderate'), CommentController.pending)
  router.get('/api/comments/:id', auth, requireCapability('comment.moderate'), CommentController.show)
  router.put('/api/comments/:id', auth, requireCapability('comment.moderate'), CommentController.update)
  router.put('/api/comments/:id/approve', auth, requireCapability('comment.moderate'), CommentController.approve)
  router.delete('/api/comments/:id', auth, requireCapability('comment.moderate'), CommentController.destroy)
}
