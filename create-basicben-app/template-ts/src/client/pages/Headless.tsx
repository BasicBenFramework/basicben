import { ReactNode } from 'react'
import { useTheme } from '../components/ThemeContext'
import { Card } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
// Generated from the interfaces in src/models/PublicContent.ts and the routes
// in src/routes/api/v1.ts. Editing the tables below by hand would put the
// response shape in two places, and the second one drifts.
import { ENDPOINTS, QUERY_PARAMS, SHAPES, ENVELOPE } from './api-reference'

interface CodeBlockProps {
  children: string
  title?: string
}

interface TableProps {
  columns: string[]
  children: ReactNode
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

  // Scrolls inside itself rather than widening the page: these tables carry
  // long type signatures and a horizontally scrolling document is worse than a
  // horizontally scrolling table.
  const Table = ({ columns, children }: TableProps) => (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className={`text-xs uppercase tracking-wide ${t.muted}`}>
            {columns.map((column) => (
              <th key={column} className="py-2 pr-4 font-medium">{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
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
          <p className={`text-sm ${t.muted} mb-4`}>
            Every route is a GET, and only published content is returned. The scope is what an API
            token needs; a signed-in session passes without one.
          </p>

          <Table columns={['Path', 'Scope', 'Returns']}>
            {ENDPOINTS.map((endpoint) => (
              <tr key={endpoint.path} className={`border-t ${t.border} align-top`}>
                <td className="py-2 pr-4">
                  <div className="font-mono">{endpoint.path}</div>
                  <div className={`text-xs mt-1 ${t.muted}`}>{endpoint.summary}</div>
                </td>
                <td className="py-2 pr-4 font-mono text-xs">{endpoint.scope}</td>
                <td className="py-2 font-mono text-xs">
                  {endpoint.collection ? `${endpoint.shape}[]` : endpoint.shape}
                </td>
              </tr>
            ))}
          </Table>

          <p className={`text-sm ${t.muted} mt-4`}>
            <code>:slug</code> also accepts a numeric id, since slugs are nullable on posts.
          </p>

          <p className={`text-sm ${t.muted} mt-4`}>
            Comments are deliberately absent. That table stores <code>author_email</code> for
            unauthenticated commenters, and a public feed of reader addresses is an incident rather
            than a feature.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Query parameters</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Accepted on the collection routes. Filtering happens in SQL rather than over the page
            that happened to load — filtering a page client-side gives an answer that depends on
            the page size.
          </p>

          <Table columns={['Name', 'Meaning']}>
            {QUERY_PARAMS.map((param) => (
              <tr key={param.name} className={`border-t ${t.border} align-top`}>
                <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap">{param.name}</td>
                <td className={`py-2 text-sm ${t.muted}`}>{param.description}</td>
              </tr>
            ))}
          </Table>

          <p className={`text-sm ${t.muted} mt-4`}>
            <code>?format=markdown</code> returns the source instead of rendered HTML. Every item
            reports the <code>format</code> it actually carries: a post written before HTML
            rendering existed has no cached HTML, and the API falls back to Markdown and says so
            rather than labelling Markdown as HTML for you to inject into a page.{' '}
            <code>basicben content:rerender</code> fills the cache.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">What comes back</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            One envelope for everything, so a consumer writes the unwrapping once.{' '}
            <code>meta.total_pages</code> is computed for you: <code>total / per_page</code> is the
            sum people get wrong, and an off-by-one there means a paginating client either misses
            the last page or loops forever on an empty one.
          </p>

          <CodeBlock title="A collection">{ENVELOPE.collection}</CodeBlock>
          <CodeBlock title="A single item">{ENVELOPE.item}</CodeBlock>
          <CodeBlock title="Anything that failed">{ENVELOPE.error}</CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            A missing or unpublished item is a <code>404</code>; a missing or insufficiently scoped
            credential is a <code>401</code>; too many requests is a <code>429</code>. There is no
            partial success — an error body carries <code>error</code> and no <code>data</code>.
          </p>
        </Card>

        {SHAPES.map((shape) => (
          <Card key={shape.name}>
            <h2 className="text-lg font-semibold mb-2">{shape.name}</h2>
            <p className={`text-sm ${t.muted} mb-4`}>{shape.description}</p>

            <Table columns={['Field', 'Type', 'Meaning']}>
              {shape.fields.map((field) => (
                <tr key={field.name} className={`border-t ${t.border} align-top`}>
                  <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap">{field.name}</td>
                  <td className={`py-2 pr-4 font-mono text-xs ${t.muted}`}>{field.type}</td>
                  <td className={`py-2 text-sm ${t.muted}`}>{field.description}</td>
                </tr>
              ))}
            </Table>
          </Card>
        ))}

        <Card>
          <h2 className="text-lg font-semibold mb-2">Media URLs</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Every URL the content API returns is absolute, resolved against <code>APP_URL</code>.
            That matters more here than anywhere else in the app: the bundled frontend can resolve{' '}
            <code>/uploads/x.png</code> because it is served from the same origin, and a static
            build on another host cannot — it would emit markup pointing at its own server.
          </p>

          <p className={`text-sm ${t.muted} mb-4`}>
            With the default local driver the app serves those files itself, which works but puts
            every image request through your Node process. Object storage is the production answer,
            and <code>publicUrl</code> points the URLs at a CDN or custom domain rather than the
            bucket's own hostname.
          </p>

          <CodeBlock title="basicben.config.js">
{`storage: {
  driver: 's3',                                 // also r2, minio, spaces, b2
  bucket: process.env.S3_BUCKET,
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  publicUrl: 'https://cdn.example.com'          // what consumers receive
}`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            The API does not refuse to serve media when the local driver is active. Refusing would
            break the same-origin case, which is legitimate, and would tell a consumer nothing
            useful — an absolute URL at least resolves wherever the app is reachable. What it does
            instead is warn once at the first request if the URL is still relative, which means{' '}
            <code>APP_URL</code> is unset.
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
          <h2 className="text-lg font-semibold mb-2">Webhooks</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            Add receivers at <code>/admin/settings</code>, one URL per line. Each gets a POST when
            a post, page or media item is created, updated or deleted — which is what stops a
            consumer polling.
          </p>

          <CodeBlock title="What arrives">
{`POST /your-hook
X-BasicBen-Event: post.created
X-BasicBen-Signature: sha256=<hex>

{ "event": "post.created", "id": 7, "slug": "hello", "at": "2026-08-18T…" }`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            The signature is an HMAC of the exact body, keyed with your <code>APP_KEY</code>.
            Verify it over the <strong>raw</strong> bytes — a body that has been parsed and
            re-serialised does not reproduce it, because whitespace and number formatting are free
            to change. That is what <code>bodyParser</code>'s <code>skip</code> option is for.
          </p>

          <CodeBlock title="Verifying on the receiving end">
{`import { verify } from '@basicbenframework/core/webhooks'

// bodyParser({ skip: '/api/webhooks/' }) left the stream unread
let raw = ''
for await (const chunk of req) raw += chunk

if (!verify(raw, req.headers['x-basicben-signature'], process.env.APP_KEY)) {
  return res.json({ error: 'Bad signature' }, 401)
}`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            Delivery is <strong>at-most-once</strong>. A failure is logged and dropped; there is no
            retry queue, because a durable one needs a table and a worker and this framework has
            neither — an in-memory retry loop would lose everything on the next deploy while
            looking like a guarantee. Treat webhooks as a latency optimisation and poll as the
            backstop if you cannot miss an event.
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
