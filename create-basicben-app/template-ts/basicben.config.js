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

  // Database configuration
  // db: {
  //   driver: 'sqlite',
  //   url: process.env.DATABASE_URL || './data.db'
  // }
}
