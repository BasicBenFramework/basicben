import { useTheme } from '../components/ThemeContext'
import { Card } from '../components/Card'
import { PageHeader } from '../components/PageHeader'

interface CodeBlockProps {
  children: string
  title?: string
}

export function Extending() {
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
        title="Extending"
        subtitle="Hooks — change what the framework does without forking it"
      />

      <div className="space-y-6">
        <Card>
          <h2 className="text-lg font-semibold mb-2">Where extensions live</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            <code>src/hooks.ts</code>, imported once by <code>src/server/index.ts</code>. Every
            listener is registered before the server handles its first request.
          </p>

          <CodeBlock title="src/hooks.ts">
{`import { hooks, HOOKS } from '@basicbenframework/core/hooks'

hooks.on(HOOKS.POST_CREATING, async (data) => ({
  ...data,
  title: data.title.trim()
}))

hooks.on(HOOKS.MEDIA_UPLOADED, async ({ url }) => {
  await purgeCdn(url)
})`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            There was once a plugin system wrapping this — an object with a name, a version and an
            activation switch. It was removed. A plugin could not be installed at runtime on any
            host that rebuilds from an image, so what remained was a container around exactly these
            calls, and <code>import</code> already does that job. Shipping an extension as an npm
            package still works: install it, import it, call <code>hooks.on</code>.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Two kinds of hook</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            The distinction is the thing to get right. A <strong>filter</strong> transforms a value
            and <em>must return it</em> — returning nothing replaces the value with undefined. A{' '}
            <strong>notification</strong> is told something happened and its return value is
            ignored.
          </p>

          <CodeBlock>
{`// Filters — return the value, changed.
'post.creating'   // return { cancel: true, reason } to refuse the write
'content.render'  // the rendered HTML, before sanitizing
'admin.menu'      // the sidebar items

// Notifications — the return value is ignored.
'post.created'
'media.uploaded'
'server.started'`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            A listener that throws is contained: the others still run. Pass a name so the logged
            error points at the culprit — without one it says which hook threw but not which
            listener, which is no help on a hook with several.
          </p>

          <CodeBlock>
{`hooks.on(HOOKS.POST_CREATED, reindex, { name: 'search-index' })

// Hook "post.created" (search-index) threw: connection refused`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            <code>priority</code> takes a number too — lower runs first, default 10. Set{' '}
            <code>BASICBEN_DEBUG_HOOKS=1</code> for stack traces.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Every hook</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            All 39, by family: <code>server.*</code>, <code>request.*</code>, <code>post.*</code>,{' '}
            <code>page.*</code>, <code>comment.*</code>,{' '}
            <code>content.render/save/delete</code>, <code>media.*</code>, <code>auth.*</code>,{' '}
            <code>email.*</code>, <code>mail.*</code>, <code>admin.*</code>. Every hook the
            framework declares fires — that is checked by a test that walks the constants and looks
            for a call site.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Where hooks fire matters</h2>
          <p className={`text-sm ${t.muted}`}>
            The registry is a singleton per JavaScript realm, and the browser is a different realm
            from the server. <code>src/hooks.ts</code> is imported by the server entry, so a hook
            fired in the browser would consult an empty registry. That is why{' '}
            <code>admin.menu</code> and <code>admin.dashboard</code> fire on the server and reach
            the UI through an API — the admin asks the server what to render, because the server is
            where the listeners are.
          </p>
        </Card>
      </div>
    </div>
  )
}
