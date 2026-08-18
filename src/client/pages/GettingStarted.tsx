import { useTheme } from '../components/ThemeContext'
import { Card } from '../components/Card'
import { PageHeader } from '../components/PageHeader'

export function GettingStarted() {
  const { t } = useTheme()

  const devCommands = [
    { cmd: 'npm run dev', desc: 'Start Vite and the API server with hot reload' },
    { cmd: 'npm run build', desc: 'Build client and server for production' },
    { cmd: 'npm run build -- --static', desc: 'Build the client only, for static hosts' },
    { cmd: 'npm run start', desc: 'Run the production server' },
    { cmd: 'npm run test', desc: 'Run tests with Vitest' },
  ]

  const makeCommands = [
    { cmd: 'npm run make:controller Post', desc: 'Generate a controller' },
    { cmd: 'npm run make:model Post', desc: 'Generate a model' },
    { cmd: 'npm run make:migration create_posts', desc: 'Generate a migration' },
    { cmd: 'npx basicben make:route post', desc: 'Generate a route file' },
    { cmd: 'npx basicben make:middleware auth', desc: 'Generate middleware' },
    { cmd: 'npx basicben make:seed posts', desc: 'Generate a seeder' },
  ]

  const dbCommands = [
    { cmd: 'npm run migrate', desc: 'Run pending migrations' },
    { cmd: 'npm run migrate:rollback', desc: 'Roll back the last batch' },
    { cmd: 'npm run migrate:fresh', desc: 'Drop everything and re-run' },
    { cmd: 'npm run migrate:status', desc: 'Show migration status' },
    { cmd: 'npx basicben seed', desc: 'Run database seeders' },
  ]

  return (
    <div>
      <PageHeader
        title="Getting Started"
        subtitle="Create a project, learn the layout, and run the CLI"
      />

      <div className="space-y-6">
        <Card>
          <h2 className="text-lg font-semibold mb-4">Quick Start</h2>
          <div className={`rounded-lg p-4 font-mono text-sm ${t.card} border ${t.border} overflow-x-auto`}>
            <div className={t.muted}># Create a new project</div>
            <div>npx @basicbenframework/create my-app</div>
            <div className="mt-2" />
            <div className={t.muted}># Navigate to the project</div>
            <div>cd my-app</div>
            <div className="mt-2" />
            <div className={t.muted}># Install dependencies</div>
            <div>npm install</div>
            <div className="mt-2" />
            <div className={t.muted}># Create the database</div>
            <div>npm run migrate</div>
            <div className="mt-2" />
            <div className={t.muted}># Start the development server</div>
            <div>npm run dev</div>
          </div>
          <p className={`text-sm ${t.muted} mt-4`}>
            What you get is the CMS: posts, pages, categories, tags, media, comments, an admin
            panel and a headless content API at <code>/api/v1</code>. Not a blank application —
            a working one you delete the parts of that you do not want. The first account you
            register becomes the admin.
          </p>
          <p className={`text-sm ${t.muted} mt-4`}>
            Apps are TypeScript. Nothing forces you to annotate anything — Vite compiles the app
            either way — but the types are there when you want them, and the admin panel is
            written against them. BasicBen requires Node 24 or later.
          </p>
          <p className={`text-sm ${t.muted} mt-4`}>
            The command downloads the CMS repository rather than unpacking a copy bundled inside
            the package, so it is never a stale snapshot. What it gives you is <em>yours</em>,
            with no link back — which is usually what you want, and means framework fixes reach
            you through <code>@basicbenframework/core</code> but CMS changes do not. If you would
            rather track the CMS and merge its fixes, fork it instead of scaffolding:{' '}
            <code>git clone https://github.com/BasicBenFramework/basicben.git my-app</code>.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-4">Project Structure</h2>
          <div className={`rounded-lg p-4 font-mono text-sm ${t.card} border ${t.border} overflow-x-auto`}>
            <pre className={t.text}>{`my-app/
├── src/
│   ├── client/           # React frontend
│   │   ├── components/   # Reusable components
│   │   ├── contexts/     # React context providers
│   │   ├── layouts/      # Page layouts
│   │   └── pages/        # Page components, including admin/
│   ├── routes/
│   │   ├── App.tsx       # Client routes
│   │   └── api/          # API route files
│   ├── controllers/      # Request handlers
│   ├── models/           # Database models
│   ├── middleware/       # Request middleware
│   ├── helpers/          # Shared utilities
│   ├── types/            # Shared type definitions
│   ├── server/           # Server entry point
│   └── main.tsx          # Client entry point
├── db/
│   ├── migrations/       # Database migrations
│   └── seeds/            # Database seeders
├── mail/                 # Email templates
├── public/               # Static assets
├── index.html            # HTML shell
├── tsconfig.json         # TypeScript config
├── vite.config.ts        # Vite config
└── basicben.config.js    # Framework config`}</pre>
          </div>
          <p className={`text-sm ${t.muted} mt-4`}>
            Both halves of the app live under <code>src/routes/</code>. <code>App.tsx</code> defines the routes the browser renders, and everything in <code>api/</code> defines the routes the server answers. Files in <code>api/</code> are loaded automatically at startup, so a new file becomes live routes without being registered anywhere.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-4">CLI Commands</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            A new project ships with npm scripts for the commands you run most. Everything else is available through <code>npx basicben</code>, and <code>npx basicben help</code> lists the full set.
          </p>

          <h3 className={`text-sm font-medium mb-2 ${t.muted}`}>Development</h3>
          <div className="grid gap-2 sm:grid-cols-2 mb-4">
            {devCommands.map(({ cmd, desc }) => (
              <div key={cmd} className={`rounded-lg p-3 ${t.card} border ${t.border}`}>
                <code className="text-sm font-semibold">{cmd}</code>
                <p className={`text-xs mt-1 ${t.muted}`}>{desc}</p>
              </div>
            ))}
          </div>

          <h3 className={`text-sm font-medium mb-2 ${t.muted}`}>Scaffolding</h3>
          <div className="grid gap-2 sm:grid-cols-2 mb-4">
            {makeCommands.map(({ cmd, desc }) => (
              <div key={cmd} className={`rounded-lg p-3 ${t.card} border ${t.border}`}>
                <code className="text-sm font-semibold">{cmd}</code>
                <p className={`text-xs mt-1 ${t.muted}`}>{desc}</p>
              </div>
            ))}
          </div>

          <h3 className={`text-sm font-medium mb-2 ${t.muted}`}>Database</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {dbCommands.map(({ cmd, desc }) => (
              <div key={cmd} className={`rounded-lg p-3 ${t.card} border ${t.border}`}>
                <code className="text-sm font-semibold">{cmd}</code>
                <p className={`text-xs mt-1 ${t.muted}`}>{desc}</p>
              </div>
            ))}
          </div>

          <p className={`text-sm ${t.muted} mt-4`}>
            The generators write TypeScript and refuse to overwrite a file that already exists. Migrations and seeders are <code>.ts</code> too — Node strips the types, so they run with no build step.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-4">Imports</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            The framework is published as <code>@basicbenframework/core</code>. It is organised into subpaths so the client bundle never pulls in server code.
          </p>

          <div className={`rounded-lg p-4 font-mono text-sm ${t.card} border ${t.border} overflow-x-auto`}>
            <pre className={t.text}>{`import { createServer } from '@basicbenframework/core/server'
import { createClientApp } from '@basicbenframework/core/client'
import { db, query } from '@basicbenframework/core/db'
import { validate, rules } from '@basicbenframework/core/validation'
import { signJwt, verifyJwt } from '@basicbenframework/core/auth'
import { can, ROLES } from '@basicbenframework/core/auth/permissions'
import { hooks, HOOKS } from '@basicbenframework/core/hooks'
import { createApiToken } from '@basicbenframework/core/auth/api-tokens'`}</pre>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-4">Configuration</h2>
          <p className={`text-sm ${t.muted} mb-4`}>
            <code>basicben.config.js</code> is read at startup. Every key is optional and falls back to a default, so you only set what you want to change.
          </p>

          <div className={`rounded-lg p-4 font-mono text-sm ${t.card} border ${t.border} overflow-x-auto`}>
            <pre className={t.text}>{`export default {
  port: 3001,

  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: true
  },

  bodyParser: {
    limit: '1mb'
  },

  static: {
    dir: 'public',
    spa: true      // serve index.html for unmatched client routes
  },

  db: {
    driver: 'sqlite',
    url: process.env.DATABASE_URL || './data.db'
  }
}`}</pre>
          </div>
          <p className={`text-sm ${t.muted} mt-4`}>
            Set <code>spa: true</code> before deploying. Without it the production server returns 404 for any client route that is not a real file, which breaks deep links and page refreshes.
          </p>
          <p className={`text-sm ${t.muted} mt-4`}>
            The same keys can be passed straight to <code>createServer</code>, which is what the
            generated <code>src/server/index.ts</code> does; an argument there wins over the file.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold mb-4">Resources</h2>
          <div className="flex flex-wrap gap-3">
            <a
              href="https://github.com/BasicBenFramework/core"
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg ${t.btnSecondary} transition text-sm`}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              GitHub
            </a>
            <a
              href="https://basicben.com"
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg ${t.btnSecondary} transition text-sm`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              Documentation
            </a>
          </div>
        </Card>
      </div>
    </div>
  )
}
