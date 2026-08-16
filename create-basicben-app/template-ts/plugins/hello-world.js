/**
 * Hello World — an example BasicBen plugin.
 *
 * Demonstrates the four things a plugin can do: read its own settings, listen
 * to hooks, filter content, and register routes.
 *
 * ## Getting settings into a hook
 *
 * This is the one part that catches people out. Hook callbacks receive the
 * hook's own payload — `request.before` gets `{ req, res }` — and **not** the
 * plugin context. Settings arrive only in `initialize`, so a plugin that wants
 * them later has to hold on to them, which is what `settings` below does.
 *
 * Reading `ctx.settings` inside a hook, which this example used to do, silently
 * yields undefined: the callback runs, the condition is always false, and
 * nothing appears to happen.
 *
 * ## Activating it
 *
 *   basicben plugin activate hello-world
 *
 * then restart the server. Activation is recorded in the database and read at
 * boot; it does not take effect in a running process.
 */

/** Populated by initialize(), read by the hooks below. */
let settings = {
  greeting: 'Hello',
  logRequests: false
}

export default {
  name: 'hello-world',
  version: '1.0.0',
  description: 'Example plugin that demonstrates the BasicBen plugin architecture',
  author: 'BasicBen',

  /** Defaults, overridable from the admin panel. */
  settings: {
    greeting: 'Hello',
    logRequests: false
  },

  hooks: {
    /**
     * Every request, before routing.
     *
     * The payload is `{ req, res }` — settings come from the closure above.
     */
    'request.before': async ({ req }) => {
      if (settings.logRequests) {
        console.log(`[hello-world] ${req.method} ${req.url}`)
      }
    },

    'server.started': async () => {
      console.log(`[hello-world] ready — greeting is "${settings.greeting}"`)
    },

    /**
     * A filter: whatever it returns replaces the rendered HTML.
     *
     * The allowlist in the content sanitizer applies to this output too, so a
     * tag it does not permit will be stripped after this runs.
     */
    'content.render': async (html) => html,

    /** A notification: the return value is ignored. */
    'post.created': async ({ post }) => {
      console.log(`[hello-world] post created: ${post.title}`)
    }
  },

  /**
   * Runs on activation. The only place settings are handed to the plugin.
   *
   * @param {Object} ctx - { router, app, config, hooks, settings, updateSettings }
   */
  initialize: async (ctx) => {
    settings = { ...settings, ...ctx.settings }

    console.log('[hello-world] initialized')
  },

  destroy: async () => {
    console.log('[hello-world] destroyed')
  },

  /**
   * Routes are registered at boot, when the plugin is activated.
   *
   * There is no route deregistration, so a plugin activated from the admin
   * panel while the server is running will not mount these until a restart.
   */
  routes: (router) => {
    router.get('/api/hello', (req, res) => {
      res.json({
        message: `${settings.greeting} from the hello-world plugin!`,
        timestamp: new Date().toISOString()
      })
    })

    router.get('/api/hello/:name', (req, res) => {
      res.json({
        message: `${settings.greeting}, ${req.params.name}!`,
        timestamp: new Date().toISOString()
      })
    })
  }
}
