import { publishDueEndpoint } from '../../helpers/publish-due'
import { newslettersCronEndpoint } from '../../helpers/newsletter'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
}

/** Endpoints for a platform scheduler. Each checks CRON_SECRET itself. */
export default (router: Router) => {
  router.get('/api/cron/publish-due', publishDueEndpoint)
  // Sends the next batch of queued newsletter mail (`?limit=`, default 100).
  // Resumable: call it every minute or two until the queue is empty.
  router.get('/api/cron/newsletters', newslettersCronEndpoint)
}
