import { hooks, HOOKS } from '@basicbenframework/core/hooks'
import { requireCapability } from '@basicbenframework/core/auth/permissions'
import { ContentTypeController } from '../../controllers/ContentTypeController.ts'
import { TaxonomyController } from '../../controllers/TaxonomyController.ts'
import { ContentType } from '../../models/ContentType.ts'
import { auth } from '../../middleware/auth.ts'
import { authOrToken } from '../../middleware/api-auth.ts'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
  post: (path: string, ...handlers: Function[]) => void
  put: (path: string, ...handlers: Function[]) => void
  delete: (path: string, ...handlers: Function[]) => void
}

/**
 * Admin API for content types and custom taxonomies.
 *
 * Reads take a session or a `content:write` token, like `/api/posts`: the
 * editor needs a type's fields to render them, and a program writing recipes
 * needs the schema it is writing against. Defining types and taxonomies is
 * `settings.manage` and a person's job (`auth` refuses tokens); managing terms
 * is `category.manage`, as categories are. The public reads are in v1.ts.
 */
export default (router: Router) => {
  const read = authOrToken('content:write')
  const manage = [auth, requireCapability('settings.manage')]
  const terms = [authOrToken('content:write'), requireCapability('category.manage')]

  router.get('/api/content-types', read, ContentTypeController.index)
  router.get('/api/content-types/:id', read, ContentTypeController.show)
  router.post('/api/content-types', ...manage, ContentTypeController.store)
  router.put('/api/content-types/:id', ...manage, ContentTypeController.update)
  router.delete('/api/content-types/:id', ...manage, ContentTypeController.destroy)

  router.get('/api/taxonomies', read, TaxonomyController.index)
  router.post('/api/taxonomies', ...manage, TaxonomyController.store)
  router.put('/api/taxonomies/:id', ...manage, TaxonomyController.update)
  router.delete('/api/taxonomies/:id', ...manage, TaxonomyController.destroy)

  router.get('/api/taxonomies/:id/terms', read, TaxonomyController.terms)
  router.post('/api/taxonomies/:id/terms', ...terms, TaxonomyController.storeTerm)
  router.put('/api/terms/:id', ...terms, TaxonomyController.updateTerm)
  router.delete('/api/terms/:id', ...terms, TaxonomyController.destroyTerm)
}

/**
 * One sidebar entry per custom content type, under Content.
 *
 * Generated from the table rather than hard-coded, so creating a "Recipes"
 * type puts Recipes in the nav for everyone the moment it is saved. Through
 * the `admin.menu` filter AdminController already fires, which is the
 * extension point for exactly this. Each entry lands right after Posts.
 *
 * The paths need the client route `/admin/content/:type` (see the Phase 3
 * report); the static Content types and Taxonomies entries belong in the two
 * hard-coded menus instead, because they never change.
 *
 * A failure here — the table missing before migrations run, say — leaves the
 * menu as it was rather than blanking it.
 */
hooks.on(HOOKS.ADMIN_MENU, async (items: Array<{ path: string; label: string; section?: string }>) => {
  try {
    const custom = (await ContentType.all()).filter((type) => !type.builtin)
    if (!Array.isArray(items) || custom.length === 0) return items

    const entries = custom.map((type) => ({
      path: `/admin/content/${type.key}`,
      label: type.plural_label,
      icon: '🗂️',
      section: 'Content'
    }))

    const at = items.findIndex((item) => item.path === '/admin/posts')
    return at === -1 ? [...items, ...entries] : [...items.slice(0, at + 1), ...entries, ...items.slice(at + 1)]
  } catch {
    return items
  }
})
