import { useTheme } from '../components/ThemeContext'
import { Card } from '../components/Card'
import { PageHeader } from '../components/PageHeader'

interface CodeBlockProps {
  children: string
  title?: string
}

export function Headless() {
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
        title="Headless API"
        subtitle="Read this site's content from somewhere else"
      />

      <div className="space-y-6">
        <Card>
          <h2 className="text-lg font-semibold mb-2">What this is</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            A read-only content API at <code>/api/v1</code>, authenticated with tokens rather than
            logins. The bundled admin and SPA are unchanged — this sits alongside them, so a blog
            can be served by the built-in frontend today and by a static site generator later
            without a rewrite.
          </p>
          <p className={`text-sm ${t.muted}`}>
            There is no <code>/api/v1</code> write surface. The admin API already has one, gated on
            roles, and a second path to the same mutations is a second place for an authorization
            bug to live.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Tokens</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Issue one at <code>/admin/tokens</code>. The plaintext is shown once and never again —
            only a SHA-256 hash is stored, so a copy of the database does not hand over working
            credentials. Losing it means issuing another.
          </p>

          <CodeBlock title="Using a token">
{`curl https://example.com/api/v1/posts \\
  -H "Authorization: Bearer bb_..."`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            The <code>bb_</code> prefix is what lets one <code>Authorization: Bearer</code> header
            carry either a token or a user session — middleware picks the verifier from the prefix
            rather than trying both.
          </p>

          <p className={`text-sm ${t.muted} mt-4`}>
            Scopes: <code>content:read</code>, <code>content:write</code>, <code>media:read</code>,{' '}
            <code>media:write</code>. A write scope grants the matching read. A token cannot manage
            tokens — otherwise a leaked read-only credential could mint itself a write-scoped one.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Endpoints</h2>

          <CodeBlock>
{`GET /api/v1/posts?page=&per_page=&category=&tag=&search=&format=
GET /api/v1/posts/:slug
GET /api/v1/pages
GET /api/v1/pages/:slug
GET /api/v1/categories
GET /api/v1/tags
GET /api/v1/media/:id`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            Only published content is returned. <code>:slug</code> also accepts a numeric id, since
            slugs are nullable on posts. <code>per_page</code> is clamped to 100. Responses are{' '}
            <code>{'{ data, meta }'}</code>, with <code>meta.total_pages</code> computed for you.
          </p>

          <p className={`text-sm ${t.muted} mt-4`}>
            <code>?format=markdown</code> returns the source instead of rendered HTML. Every item
            reports the <code>format</code> it actually carries: a post written before HTML
            rendering existed has no cached HTML, and the API falls back to Markdown and says so
            rather than labelling Markdown as HTML for you to inject into a page.{' '}
            <code>basicben content:rerender</code> fills the cache.
          </p>

          <p className={`text-sm ${t.muted} mt-4`}>
            Comments are deliberately absent. That table stores <code>author_email</code> for
            unauthenticated commenters, and a public feed of reader addresses is an incident rather
            than a feature.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Public reads</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Off by default: <code>/api/v1</code> requires a credential. Set <code>public_api</code>{' '}
            to <code>true</code> in settings to serve content anonymously — appropriate for a site
            whose content is public anyway, and for letting a browser-side consumer read it without
            shipping a token to the browser.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Caching</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Every read carries an <code>ETag</code> and <code>Cache-Control</code>, and a request
            with <code>If-None-Match</code> gets a <code>304</code> with no body. A build step that
            re-fetches the same content repeatedly — which is what most consumers are — stops
            re-downloading it.
          </p>

          <CodeBlock>
{`curl -H "Authorization: Bearer bb_..." \\
     -H 'If-None-Match: "1b2-uSkhG..."' \\
     https://example.com/api/v1/posts
# 304, zero bytes`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            Static files get the same treatment, plus <code>Accept-Ranges</code> and real{' '}
            <code>206</code> responses, so media can be seeked and resumed. Previously{' '}
            <code>Last-Modified</code> was sent and the <code>If-Modified-Since</code> that came
            back was ignored, so every conditional request was answered with the whole file.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Rate limits</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            120 requests a minute, per address. Every response carries{' '}
            <code>RateLimit-Limit</code>, <code>RateLimit-Remaining</code> and{' '}
            <code>RateLimit-Reset</code>; a refused one adds <code>Retry-After</code> and a 429.
          </p>
          <p className={`text-sm ${t.muted}`}>
            Per-token budgets would be the better accounting — a build server on a shared CI
            address would get its own — but a limiter has to run before authentication, or a flood
            of fabricated tokens is never limited at all. Before authentication the token is
            unverified, and keying on an unverified string hands an attacker a fresh budget per
            fabricated token. So the address it is. The limit is set high enough that sharing one
            rarely bites: a build fetching a thousand posts at the maximum hundred per page is ten
            requests.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">CORS</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            A browser-side consumer on another origin needs an allowlist. The default is{' '}
            <code>origin: '*'</code>, which works for public reads but cannot carry credentials.
          </p>

          <CodeBlock title="basicben.config.js">
{`export default {
  cors: {
    origin: ['https://blog.example.com', 'https://staging.example.com'],
    credentials: true
  }
}`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            <code>origin</code> takes a string, an array, or a function of the request origin.
            Setting <code>'*'</code> together with <code>credentials: true</code> is refused with a
            warning rather than honoured: browsers reject that pairing outright, so it would break
            every credentialed request silently. An origin that is not on the list receives no{' '}
            <code>Access-Control-Allow-Origin</code> at all, which is what makes the browser refuse
            it.
          </p>
        </Card>
      </div>
    </div>
  )
}
