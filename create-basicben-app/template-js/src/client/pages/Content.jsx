import { useTheme } from '../components/ThemeContext'
import { Card } from '../components/Card'
import { PageHeader } from '../components/PageHeader'

export function Content() {
  const { t } = useTheme()

  const CodeBlock = ({ children, title }) => (
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
        title="Content & Markdown"
        subtitle="Posts are written in Markdown, rendered and sanitized on save"
      />

      <div className="space-y-6">
        <Card>
          <h2 className="text-lg font-semibold mb-2">Rendering</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Every table that stores content keeps two columns. <code>content</code> holds the
            Markdown and is canonical; <code>content_html</code> holds the rendered, sanitized
            result. Themes read the second one.
          </p>

          <CodeBlock title="The content pipeline">
{`import { renderContent, excerpt, slugify } from '@basicbenframework/core/content'

const html = await renderContent('# Title\\n\\nSome **bold** text.')
const summary = excerpt(markdown, 200)   // plain text, cut at a word boundary
const url = slugify('Hello, World!')     // "hello-world"`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            Rendering happens on <strong>save</strong>, not per request — a blog is read far more
            often than written. The models do it for you: <code>Post.create</code> and{' '}
            <code>Post.update</code> re-render whenever <code>content</code> changes, so the two
            columns cannot drift apart.
          </p>

          <div className={`mt-4 p-3 rounded-lg border ${t.border} ${t.card}`}>
            <p className="text-sm">
              <strong>Never render <code>content</code> as HTML.</strong> It is Markdown.{' '}
              <code>content_html</code> is the column that has been through the sanitizer.
            </p>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Why there is no Markdown dependency</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            The framework has no runtime dependencies, and this is where that argument usually
            breaks down: surely hand-writing a parser is an XSS risk. It is the reverse.
            CommonMark <em>requires</em> raw HTML to pass through verbatim — 64 of the spec's 652
            cases exist to pin that down — which is exactly why every off-the-shelf parser tells
            you to sanitize its output. The dependency introduces the hazard rather than removing
            it.
          </p>
          <p className={`text-sm ${t.muted}`}>
            This parser refuses those 64 cases deliberately. It escapes everything it reads and
            emits only tags from its own vocabulary, so no input can become a tag. The correctness
            you give up is measured rather than claimed: it passes <strong>93% of the CommonMark
            suite</strong> excluding the raw-HTML sections, checked on every test run with a floor
            that fails the build on regression.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Supported syntax</h2>
          <p className={`text-sm ${t.muted}`}>
            Headings (ATX and setext), emphasis, strong, strikethrough, inline code, fenced and
            indented code blocks, blockquotes, nested and tight/loose lists, links, reference
            links, images, autolinks, tables, hard line breaks, backslash escapes and HTML
            entities. Headings get <code>id</code> anchors automatically.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Sanitizing other HTML</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            The parser is safe on its own, but imported content is not — a WordPress export, a
            plugin's output, a field you deliberately opened up to raw HTML.
          </p>

          <CodeBlock title="Allowlist-based sanitization">
{`import { sanitizeHtml } from '@basicbenframework/core/content'

sanitizeHtml(imported)                            // allowlist, drops the rest
sanitizeHtml(imported, { schemes: ['https'] })    // narrow the URL schemes
sanitizeHtml(imported, { allowed: { p: [], a: ['href'] } })`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            Anything not named is removed. <code>script</code>, <code>style</code>,{' '}
            <code>iframe</code>, <code>svg</code> and <code>math</code> go with their contents;
            other unknown tags are unwrapped so their text survives. Event handlers and{' '}
            <code>style</code> attributes never pass. URLs are checked after entity decoding, so{' '}
            <code>&amp;#x6A;avascript:</code> is caught.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Extending the pipeline</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Plugins post-process rendered HTML through the <code>content.render</code> filter —
            syntax highlighting, lazy-loaded images, a table of contents.
          </p>

          <CodeBlock title="A plugin filtering rendered content">
{`hooks.on('content.render', (html, { table, id }) =>
  html.replace(/<code>/g, '<code class="hljs">')
)`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            The filter runs <strong>before</strong> sanitization, never after — so no plugin can
            put markup on the page the allowlist has not seen. The practical consequence, and the
            first thing you will hit writing one: your markup is subject to the allowlist too.{' '}
            <code>&lt;span class&gt;</code> and <code>&lt;code class&gt;</code> pass;{' '}
            <code>&lt;p class&gt;</code> does not, and the attribute will simply be gone. Widen
            the list rather than moving the filter.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Rerendering</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Stored HTML goes stale when the parser changes, the allowlist changes, or a plugin
            that hooks <code>content.render</code> is installed or removed.
          </p>

          <CodeBlock title="Rebuild content_html from the Markdown">
{`basicben content:rerender
basicben content:rerender posts     # just one table
basicben content:rerender --dry-run`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            It only ever writes <code>content_html</code>, so it is safe to run repeatedly.
          </p>
        </Card>
      </div>
    </div>
  )
}
