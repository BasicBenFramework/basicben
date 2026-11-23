import { publishDueEndpoint } from '../../helpers/publish-due'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
}

/** Endpoints for a platform scheduler. Each checks CRON_SECRET itself. */
export default (router: Router) => {
  router.get('/api/cron/publish-due', publishDueEndpoint)
}
