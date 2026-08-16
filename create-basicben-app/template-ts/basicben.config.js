/**
 * BasicBen Configuration
 *
 * See documentation for all available options.
 */

export default {
  // Server options
  port: 3001,

  // CORS configuration
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: true
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

  // Object storage for the media library.
  //
  // Uploads go straight from the browser to the bucket — this server only signs
  // a URL and records a row, so file size is not limited by bodyParser above.
  //
  // Without credentials the local driver writes to public/uploads, so a new
  // project works before anyone has a cloud account.
  //
  // R2, S3, MinIO, Backblaze B2 and DigitalOcean Spaces all speak the same API.
  // Switching between them is the endpoint and region, nothing else.
  storage: {
    // driver: 's3',
    // bucket: process.env.S3_BUCKET,
    // accessKeyId: process.env.S3_ACCESS_KEY_ID,
    // secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,

    // Cloudflare R2:
    // endpoint: 'https://<account-id>.r2.cloudflarestorage.com',
    // region: 'auto',

    // AWS S3: omit the endpoint and name a real region.
    // region: 'us-east-1',

    // Serve through a CDN or custom domain rather than the bucket URL:
    // publicUrl: 'https://cdn.example.com',

    maxSize: 10 * 1024 * 1024
  },

  // Database configuration
  // db: {
  //   driver: 'sqlite',
  //   url: process.env.DATABASE_URL || './data.db'
  // }
}
