import { FeedController } from '../../controllers/FeedController'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
}

export default (router: Router) => {
  // RSS, JSON Feed and the sitemap describe *this* app's public site. With
  // DISABLE_PUBLIC_SITE that site does not exist, so they are not registered:
  // a feed advertising pages that render nothing, and a sitemap inviting
  // search engines to index them, are worse than absent.
  //
  // The content API at /api/v1 is unaffected — a headless consumer reads that,
  // and serving one is the whole point of running in this mode.
  if (process.env.DISABLE_PUBLIC_SITE === 'true') return

  router.get('/feed.xml', FeedController.rss)
  router.get('/feed.json', FeedController.json)
  router.get('/sitemap.xml', FeedController.sitemap)
}
