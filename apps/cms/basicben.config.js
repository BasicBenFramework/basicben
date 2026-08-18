/**
 * BasicBen Configuration
 *
 * See documentation for all available options.
 */

export default {
  // Server options
  port: 3001,

  // CORS configuration
  //
  // The bundled SPA is same-origin and authenticates with `Authorization:
  // Bearer`, not cookies, so it needs no credentials. Leaving `credentials:
  // true` alongside `origin: '*'` was a pairing browsers reject outright — the
  // framework warned about it and dropped the header on every boot.
  //
  // A cross-origin consumer that does need credentials names its origins:
  //
  //   origin: ['https://blog.example.com'],
  //   credentials: true
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: false
  },

  // Body parser options
  bodyParser: {
    limit: '1mb'
  },

  // Static file serving
  static: {
    dir: 'public'
  },

  // Mail. 'console' logs the message instead of sending, so a new project works
  // with no mail account — the verification link is printed to the terminal.
  //
  // For real delivery use 'resend' (its SMTP relay, api key as the password),
  // 'smtp' for any other provider, or 'http' to POST to a provider's API.
  mail: {
    from: process.env.MAIL_FROM || 'BasicBen <onboarding@resend.dev>',
    transport: process.env.RESEND_API_KEY ? 'resend' : 'console',
    apiKey: process.env.RESEND_API_KEY

    // Any other SMTP provider, including Mailpit in development:
    // transport: 'smtp',
    // host: process.env.SMTP_HOST,
    // port: Number(process.env.SMTP_PORT) || 587,
    // user: process.env.SMTP_USER,
    // pass: process.env.SMTP_PASS
  },

  // Object storage for the media library. See resolveStorage() below.
  storage: resolveStorage(),

  // Database configuration
  // db: {
  //   driver: 'sqlite',
  //   url: process.env.DATABASE_URL || './data.db'
  // }
}

/**
 * Object storage for the media library.
 *
 * Uploads go straight from the browser to the bucket — this server only signs a
 * URL and records a row, so file size is not limited by the body parser.
 *
 * Without credentials the local driver writes to public/uploads, so a new
 * project works before anyone has a cloud account. R2, S3, MinIO, Backblaze B2
 * and DigitalOcean Spaces all speak the same API; switching between them is the
 * endpoint and region, nothing else. `publicUrl` is what a consumer actually
 * receives, so point it at a CDN or custom domain rather than the bucket host.
 *
 * On a serverless platform the local driver is not a weaker default, it is a
 * broken one: the filesystem is read-only apart from an ephemeral /tmp, so
 * uploads cannot work at all and anything written would vanish with the
 * instance. Hence the warning.
 *
 * It warns rather than throws. The framework catches any error raised while
 * loading this file, reports it as a syntax problem and continues with an
 * *empty* config — so throwing here would silently discard CORS, mail and the
 * port along with itself. Reads are unaffected either way: only uploads break.
 */
function resolveStorage() {
  const maxSize = 10 * 1024 * 1024

  if (!process.env.S3_BUCKET) {
    if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
      console.warn(
        '[storage] No object storage configured, and this platform has a ' +
          'read-only filesystem. Uploads will fail. Set S3_BUCKET, ' +
          'S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_ENDPOINT and S3_PUBLIC_URL.'
      )
    }

    return { maxSize }
  }

  return {
    driver: 's3',
    bucket: process.env.S3_BUCKET,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    // Cloudflare R2: https://<account-id>.r2.cloudflarestorage.com with region
    // 'auto'. AWS S3: leave the endpoint unset and name a real region.
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'auto',
    publicUrl: process.env.S3_PUBLIC_URL,
    maxSize
  }
}
