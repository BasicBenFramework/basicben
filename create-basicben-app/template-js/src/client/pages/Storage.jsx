import { useTheme } from '../components/ThemeContext'
import { Card } from '../components/Card'
import { PageHeader } from '../components/PageHeader'

export function Storage() {
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
        title="Object Storage"
        subtitle="R2, S3, MinIO, B2 and Spaces — one driver, no AWS SDK"
      />

      <div className="space-y-6">
        <Card>
          <h2 className="text-lg font-semibold mb-2">The adapter</h2>

          <CodeBlock title="Working with objects">
{`import { getStorage } from '@basicbenframework/core/storage'

const storage = await getStorage()

await storage.put('media/a.png', bytes, { contentType: 'image/png' })
await storage.get('media/a.png')          // → { body, contentType, size, etag }
await storage.head('media/a.png')         // → metadata, or null
await storage.delete('media/a.png')
await storage.list({ prefix: 'media/' })  // → { items, cursor }

storage.signedUrl('media/a.png', { method: 'PUT', expiresIn: 900 })
storage.publicUrl('media/a.png')`}
          </CodeBlock>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">One driver, not two</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            R2 speaks the S3 API, and so do MinIO, Backblaze B2 and DigitalOcean Spaces. The
            difference between them is an endpoint and a region, so there is one driver and no
            branching in application code. Moving from R2 to S3 is two lines of config.
          </p>

          <CodeBlock title="basicben.config.js — Cloudflare R2">
{`storage: {
  driver: 's3',
  endpoint: 'https://<account-id>.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: process.env.S3_BUCKET,
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  publicUrl: 'https://cdn.example.com'   // optional CDN or custom domain
}`}
          </CodeBlock>

          <CodeBlock title="AWS S3 — omit the endpoint, name a real region">
{`storage: {
  driver: 's3',
  region: 'us-east-1',
  bucket: process.env.S3_BUCKET,
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
}`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            Configure nothing and the <code>local</code> driver writes to{' '}
            <code>public/uploads</code>, so a new project works before anyone has a cloud account.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">No AWS SDK</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            <code>@aws-sdk/client-s3</code> is tens of megabytes for what is, underneath, one HMAC
            chain. SigV4 is HMAC-SHA256 and SHA-256, both already in <code>node:crypto</code>, so
            the signer is written here and <code>dependencies</code> stays empty.
          </p>
          <p className={`text-sm ${t.muted}`}>
            A hand-rolled signer is only worth trusting if it is checked against something outside
            itself, so it is checked two ways: AWS's own <strong>34 published test vectors</strong>,
            stage by stage, and <strong>a real MinIO server</strong> — the only thing that proves
            an actual S3 implementation accepts what it produces. That second check earned its
            place immediately: S3 does not normalize signed paths the way every other AWS service
            does, and the published vectors would never have caught it.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">How an upload works</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            The browser PUTs straight to the bucket. This server signs a URL and records a row;
            the file bytes never pass through Node.
          </p>

          <CodeBlock title="Two steps, with the bytes going elsewhere">
{`Browser                    BasicBen                  R2 / S3
   │  POST /api/media/sign    │                         │
   │─────────────────────────>│  (validate, then sign)  │
   │  { uploadUrl, key,       │                         │
   │    ticket, headers }     │                         │
   │<─────────────────────────│                         │
   │  PUT <uploadUrl>  ────── file bytes ──────────────> │
   │  POST /api/media/confirm │                         │
   │─────────────────────────>│  HEAD, then INSERT      │`}
          </CodeBlock>

          <p className={`text-sm ${t.muted} mt-4`}>
            Content type and size are validated <strong>before</strong> anything is signed,
            because a caller without a signed URL cannot upload at all — that is the enforcement
            point, not a courtesy check. HTML, SVG and JavaScript are refused outright: a bucket
            served from a domain hands those back with the type they were stored under, which is
            same-origin script execution.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Two things a presigned URL does not do</h2>

          <p className={`text-sm ${t.muted} mb-3`}>
            <strong>It does not cap the size.</strong> A URL issued for a thumbnail will accept a
            gigabyte. <code>confirm</code> therefore HEADs the stored object and deletes it if it
            came back larger than allowed. The declared size is checked too, but only the stored
            size is believed.
          </p>

          <p className={`text-sm ${t.muted}`}>
            <strong>It does not say who uploaded what.</strong> The key travels through the
            browser, so each signed upload carries a <em>ticket</em> — an HMAC over the key, the
            owner and the expiry — checked at confirm time. Without it a caller could confirm
            someone else's object as its own media row. It is stateless, so there is no
            pending-upload table to clean up.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-2">Plugin hooks</h2>

          <CodeBlock title="Rewrite a key, or refuse an upload">
{`hooks.on('media.uploading', (upload) => ({
  ...upload,
  key: \`tenant-7/\${upload.key}\`
}))

hooks.on('media.uploading', (upload) => ({
  ...upload,
  cancel: true,
  reason: 'Quota exceeded.'
}))

hooks.on('media.uploaded', ({ key, url }) => purgeCdn(url))
hooks.on('media.deleted', ({ key }) => purgeCdn(key))`}
          </CodeBlock>
        </Card>
      </div>
    </div>
  )
}
