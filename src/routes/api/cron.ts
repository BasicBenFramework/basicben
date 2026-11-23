import { publishDueEndpoint } from '../../helpers/publish-due'
import { cronTickEndpoint } from '../../host/cron'
import { newslettersCronEndpoint } from '../../helpers/newsletter'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
}

/** Endpoints for a platform scheduler. Each checks CRON_SECRET itself. */
export default (router: Router) => {
  // Everything scheduled, core's and every feature's: the one route a
  // platform cron needs. See src/host/cron.ts.
  router.get('/api/cron/tick', cronTickEndpoint)
  router.get('/api/cron/publish-due', publishDueEndpoint)
  // Sends the next batch of queued newsletter mail (`?limit=`, default 100).
  // Resumable: call it every minute or two until the queue is empty.
  router.get('/api/cron/newsletters', newslettersCronEndpoint)
}
