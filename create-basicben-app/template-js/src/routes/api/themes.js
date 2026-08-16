import { ThemeController } from '../../controllers/ThemeController.js'

export default (router) => {
  // Public: the browser asks which theme to render with. Read-only — themes
  // are switched from the CLI with `basicben theme activate <slug>`.
  router.get('/api/themes/active', ThemeController.active)
  router.get('/api/themes', ThemeController.index)
}
