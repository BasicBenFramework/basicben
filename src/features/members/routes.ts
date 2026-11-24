import { requireCapability } from '@basicbenframework/core/auth/permissions'
import { MemberController } from './MemberController.ts'
import { MemberAdminController } from './MemberAdminController.ts'
import { auth } from '../../middleware/auth.ts'
import { requireMember } from './middleware.ts'
import { memberMagicLinkLimit, memberVerifyLimit, memberAccountLimit, memberUnsubscribeLimit } from './rate-limits.ts'
import { newslettersCronEndpoint } from './newsletter.ts'
import { Post } from '../../models/Post.ts'
import type { Router } from '../../host'
import type { Request } from '../../types'

/**
 * Members, newsletters, and their admin.
 *
 * The member routes sit under /api/v1 because headless front ends call them,
 * but outside `requireScope`: a reader's browser holds no `content:read`
 * token (that is the site's secret), and the member session is the credential
 * here. Each is rate limited on its own bucket. They are not `cacheable` —
 * every response is about one person.
 *
 * The admin routes are `auth` then a capability, like every other admin
 * route. `auth` refuses member sessions outright: they are signed with a
 * different key and never verify as an admin session.
 */
export function memberRoutes(router: Router): void {
  // --- Readers (cross-origin, bearer tokens, no cookies) ---------------------
  router.post('/api/v1/members/magic-link', memberMagicLinkLimit, MemberController.magicLink)
  router.post('/api/v1/members/verify', memberVerifyLimit, MemberController.verify)
  router.get('/api/v1/members/verify', memberVerifyLimit, MemberController.verify)
  router.get('/api/v1/members/me', requireMember, memberAccountLimit, MemberController.me)
  router.put('/api/v1/members/me', requireMember, memberAccountLimit, MemberController.update)
  router.post('/api/v1/members/signout', requireMember, memberAccountLimit, MemberController.signout)

  // The newsletter's unsubscribe link: GET shows a button, POST (and RFC 8058
  // one-click) unsubscribes. The signed token is the credential.
  router.get('/api/v1/members/unsubscribe', memberUnsubscribeLimit, MemberController.unsubscribePage)
  router.post('/api/v1/members/unsubscribe', memberUnsubscribeLimit, MemberController.unsubscribe)

  // --- Admin: the member list (admin only) ----------------------------------
  const manage = [auth, requireCapability('user.manage')]

  router.get('/api/members', ...manage, MemberAdminController.index)
  // Before /api/members/:id so neither is read as an id.
  router.get('/api/members/export', ...manage, MemberAdminController.export)
  router.post('/api/members/import', ...manage, MemberAdminController.import)
  router.post('/api/members', ...manage, MemberAdminController.store)
  router.put('/api/members/:id', ...manage, MemberAdminController.update)
  router.delete('/api/members/:id', ...manage, MemberAdminController.destroy)
  router.get('/api/newsletters', ...manage, MemberAdminController.sends)

  // --- Admin: one post's newsletter -----------------------------------------
  // Anyone who may edit the post may see whether it went out and mail
  // themselves a preview; *requesting* the send is `post.edit` outright, and
  // is checked where the flag is saved (PostController via newsletterRefusal).
  const editablePost = requireCapability('post.edit', {
    loadResource: async (req: Request) => {
      const post = await Post.find(Number(req.params.id))
      return post && !post.deleted_at ? (post as unknown as Record<string, unknown>) : null
    }
  })

  router.get('/api/posts/:id/newsletter', auth, editablePost, MemberAdminController.status)
  router.post('/api/posts/:id/newsletter/test', auth, editablePost, MemberAdminController.test)

  // Kept from before the cron tick, which now sends newsletters too. Sends
  // the next batch now (`?limit=`, default 100), whether or not one is due.
  router.get('/api/cron/newsletters', newslettersCronEndpoint)
}
