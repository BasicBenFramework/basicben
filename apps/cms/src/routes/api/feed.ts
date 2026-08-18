import { FeedController } from '../../controllers/FeedController'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
}

export default (router: Router) => {
  // RSS and JSON Feed
  router.get('/feed.xml', FeedController.rss)
  router.get('/feed.json', FeedController.json)
  router.get('/sitemap.xml', FeedController.sitemap)
}
