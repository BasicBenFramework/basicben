import { themes } from '@basicbenframework/core/themes'
import { hooks, HOOKS } from '@basicbenframework/core/hooks'

/**
 * Themes, read-only.
 *
 * The server already registers every theme in `themes/` at boot and resolves
 * which one is active from the stored settings, so this only has to report
 * what the manager already knows. Switching is `basicben theme activate
 * <slug>` — there is no admin UI in this template to do it from.
 *
 * The client needs this endpoint because a theme's layouts are React
 * components rendering in the browser, which has no way to read the themes
 * directory or the database. Without it `ThemeProvider` falls back to the
 * default theme and an activated theme would never appear.
 */
export const ThemeController = {
  async active(req, res) {
    const theme = themes.getActive()

    if (!theme) {
      return res.json({ error: 'No active theme' }, 404)
    }

    // A filter, so a plugin can decide which theme actually renders — preview
    // modes and per-audience themes both need to override the stored choice.
    const rendered = await hooks.filter(
      HOOKS.THEME_RENDER,
      { ...theme, active: true },
      { req }
    )

    res.json({ theme: rendered })
  },

  async index(req, res) {
    res.json({ themes: themes.list() })
  }
}
