import { SnippetController } from '../../controllers/SnippetController.ts'
import { auth } from '../../middleware/auth.ts'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
  post: (path: string, ...handlers: Function[]) => void
  put: (path: string, ...handlers: Function[]) => void
  delete: (path: string, ...handlers: Function[]) => void
}

/**
 * Snippets: reusable Markdown for the editor.
 *
 * Session-only. They exist to be inserted while writing in the admin; a
 * program creating posts sends the finished Markdown and has no use for them.
 * Who may use and manage them is decided in the controller, against the row.
 */
export default (router: Router) => {
  router.get('/api/snippets', auth, SnippetController.index)
  router.get('/api/snippets/:id', auth, SnippetController.show)
  router.post('/api/snippets', auth, SnippetController.store)
  router.put('/api/snippets/:id', auth, SnippetController.update)
  router.delete('/api/snippets/:id', auth, SnippetController.destroy)
}
