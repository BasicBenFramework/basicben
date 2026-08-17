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
 * ## Registering it
 *
 * `src/server/index.ts` imports this file and passes it to `createServer`. That
 * is the portable way: a static import survives a production build, where a
 * directory scan finds nothing because the source tree was never deployed. The
 * `plugins/` folder is scanned as well, so during development you can drop a
 * file in and restart without editing the server entry.
 *
 * ## Activating it
 *
 *   basicben plugin activate hello-world
 *
 * then restart the server. Activation is recorded in the database and read at
 * boot; it does not take effect in a running process.
 *
 * ## Why .ts and not .tsx
 *
 * Node strips TypeScript types natively, so this file imports with no build
 * step — as long as it sticks to erasable syntax. An `enum`, a `namespace` or
 * a constructor parameter property emits real runtime code that stripping
 * cannot produce, and the plugin will fail to load. JSX is not stripped at all,
 * which is why plugins cannot be `.tsx`.
 */

/** The raw request, before routing has parsed anything out of it. */
interface IncomingRequest {
  method?: string
  url?: string
}

/** Just enough of the router to register a couple of routes. */
interface PluginRouter {
  get: (
    path: string,
    handler: (
      req: { params: Record<string, string> },
      res: { json: (data: unknown) => void }
    ) => void
  ) => void
}

interface HelloWorldSettings {
  greeting: string
  logRequests: boolean
}

/** Populated by initialize(), read by the hooks below. */
let settings: HelloWorldSettings = {
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
    'request.before': async ({ req }: { req: IncomingRequest }) => {
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
    'content.render': async (html: string) => html,

    /** A notification: the return value is ignored. */
    'post.created': async ({ post }: { post: { title: string } }) => {
      console.log(`[hello-world] post created: ${post.title}`)
    }
  },

  /**
   * Runs on activation. The only place settings are handed to the plugin.
   */
  initialize: async (ctx: { settings?: Partial<HelloWorldSettings> }) => {
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
  routes: (router: PluginRouter) => {
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
