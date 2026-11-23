import { CommentController } from '../../controllers/CommentController'
import { auth, optionalAuth } from '../../middleware/auth'
import { commentLimit, unsubscribeLimit } from '../../middleware/rate-limits'
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

  // The unsubscribe link in a reply notification. No session — the signed
  // token is the authority — and registered before `/api/comments/:id`, which
  // would otherwise claim the path and ask for one. Rate limited, since it is
  // as open as posting.
  router.get('/api/comments/unsubscribe', unsubscribeLimit, CommentController.unsubscribePage)
  router.post('/api/comments/unsubscribe', unsubscribeLimit, CommentController.unsubscribe)

  // Admin routes (authenticated)
  router.get('/api/comments', auth, requireCapability('comment.moderate'), CommentController.index)
  router.get('/api/comments/pending', auth, requireCapability('comment.moderate'), CommentController.pending)

  // The comment settings this workstream owns (blocklist, link limit, who is
  // notified). Readable by moderators; changing them is site configuration.
  // Static paths before `:id`, which matches anything.
  router.get('/api/comments/settings', auth, requireCapability('comment.moderate'), CommentController.settings)
  router.put('/api/comments/settings', auth, requireCapability('settings.manage'), CommentController.updateSettings)

  router.post('/api/comments/bulk', auth, requireCapability('comment.moderate'), CommentController.bulk)
  router.post('/api/comments/empty', auth, requireCapability('comment.moderate'), CommentController.empty)

  router.get('/api/comments/:id', auth, requireCapability('comment.moderate'), CommentController.show)
  router.put('/api/comments/:id', auth, requireCapability('comment.moderate'), CommentController.update)
  router.put('/api/comments/:id/approve', auth, requireCapability('comment.moderate'), CommentController.approve)
  router.put('/api/comments/:id/status', auth, requireCapability('comment.moderate'), CommentController.setStatus)
  router.delete('/api/comments/:id', auth, requireCapability('comment.moderate'), CommentController.destroy)
}
