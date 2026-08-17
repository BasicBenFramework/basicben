import { useTheme } from '../components/ThemeContext'
import { Card } from '../components/Card'
import { PageHeader } from '../components/PageHeader'

interface CodeBlockProps {
  children: string
  title?: string
}

export function Plugins() {
  const { t } = useTheme()

  const CodeBlock = ({ children, title }: CodeBlockProps) => (
    <div className="mt-4">
      {title && <div className={`text-xs font-medium mb-2 ${t.muted}`}>{title}</div>}
      <div className={`rounded-lg p-4 font-mono text-sm ${t.card} border ${t.border} overflow-x-auto`}>
        <pre className={t.text}>{children}</pre>
      </div>
    </div>
  )

  return (
    <div>
      <PageHeader
        title="Plugins"
        subtitle="One file, a set of hooks, and routes of its own — shipped with your code"
      />

      <div className="space-y-6">
        <Card>
          <h2 className="text-lg font-semibold mb-2">Writing a plugin</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            A plugin is one file that default-exports an object. The distinction that matters is
            between the two kinds of hook.
          </p>

          <CodeBlock title="plugins/my-plugin.js">
{`export default {
  name: 'my-plugin',
  version: '1.0.0',

  hooks: {
    // A filter: return the value, changed. Return { cancel: true, reason }
    // to refuse the write entirely.
    'post.creating': async (data) => ({ ...data, title: data.title.trim() }),
    'content.render': async (html) => html.replace(/<code>/g, '<code class="hljs">'),
    'admin.menu': async (items) => [...items, { path: '/admin/seo', label: 'SEO' }],

    // A notification: the return value is ignored.
    'post.created': async ({ post }) => { await index(post) },
    'media.uploaded': async ({ key, url }) => { await purgeCdn(url) }
  },

  routes: (router) => {
    router.get('/api/hello', (req, res) => res.json({ ok: true }))
  }
}`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            Available families: <code>server.*</code>, <code>request.*</code>,{' '}
            <code>post.*</code>, <code>page.*</code>, <code>comment.*</code>,{' '}
            <code>content.render/save/delete</code>, <code>media.*</code>, <code>auth.*</code>,{' '}
            <code>admin.*</code>, <code>plugin.*</code>,{' '}
            <code>mail.*</code>. Every hook the framework declares fires — that is checked by a
            test that walks the constants and looks for a call site.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Registering</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Two ways, and the difference only shows up at deploy time. Passing the plugin to{' '}
            <code>createServer</code> is a static import, so it survives a production build. The{' '}
            <code>plugins/</code> directory is scanned as well, which is convenient while you work
            — but a scan reads the source tree at runtime, and a host that ships a bundle has no
            source tree to read.
          </p>

          <CodeBlock title="src/server/index.ts">
{`import helloWorld from '../../plugins/hello-world'

const app = await createServer({
  // Bundled with the app. Works everywhere.
  plugins: [helloWorld],

  // Also scanned, for dropping a file in during development.
  // Set to false to load only what is listed above.
  pluginsDir: 'plugins'
})`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            A plugin named in both is registered once, from the list. <code>plugins: false</code>{' '}
            turns the system off entirely.
          </p>

          <p className={`text-sm ${t.muted} mt-4`}>
            There is no install command and no plugin registry. A plugin is source in your
            repository, so it arrives the way the rest of your code does — through git and your
            package manager. Downloading one into a running server is the WordPress model, and it
            does not survive a redeploy on any host that rebuilds from an image.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Settings reach initialize, not the hooks</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            This is the thing that catches people out. A hook callback receives the hook's own
            payload — <code>request.before</code> gets <code>{'{ req, res }'}</code> — and not the
            plugin context. Settings arrive only in <code>initialize</code>, so a plugin that
            wants them later has to keep them.
          </p>

          <CodeBlock title="Holding on to your settings">
{`let settings = {}

export default {
  settings: { greeting: 'Hello' },

  initialize: async (ctx) => {
    settings = { ...settings, ...ctx.settings }
  },

  hooks: {
    'server.started': async () => console.log(settings.greeting)
  }
}`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            Reading <code>ctx.settings</code> inside a hook yields undefined silently: the callback
            runs, the condition is always false, and nothing appears to happen.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Activating</h2>

          <CodeBlock title="From the CLI">
{`basicben plugin activate my-plugin
basicben plugin deactivate my-plugin`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            The choice is stored in the database and read at boot — the same list the admin panel
            writes. <strong>Restart the server for it to take effect:</strong> routes are
            registered at boot and there is no deregistration, so a plugin enabled in a running
            process would not mount its routes. Setting <code>enabledPlugins</code> in{' '}
            <code>basicben.config.js</code> overrides the stored list, for a deployment that wants
            to pin it.
          </p>

          <p className={`text-sm ${t.muted} mt-4`}>
            A hook that throws is reported with the plugin that caused it and the others carry on,
            so one broken plugin cannot silently disable the rest. Set{' '}
            <code>BASICBEN_DEBUG_HOOKS=1</code> for stack traces.
          </p>

          <p className={`text-sm ${t.muted} mt-4`}>
            Plugins may be <code>.js</code>, <code>.mjs</code> or <code>.ts</code> — Node strips
            types natively, so a TypeScript plugin needs no build step as long as it sticks to
            erasable syntax (no <code>enum</code>, no <code>namespace</code>).{' '}
            <code>.tsx</code> needs a build step and is not loaded.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Where hooks fire matters</h2>
          <p className={`text-sm ${t.muted}`}>
            The hook registry is a singleton per JavaScript realm, and the browser is a different
            realm from the server. A plugin loaded from <code>plugins/</code> registers in the
            server's registry, so a hook fired in the browser would consult an empty one. That is
            why <code>admin.menu</code> and <code>admin.dashboard</code> fire on the server and
            reach the UI through an API — the admin asks the server what to render, because the
            server is where plugins are.
          </p>
        </Card>
      </div>
    </div>
  )
}
