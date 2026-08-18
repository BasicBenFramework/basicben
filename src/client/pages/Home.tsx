import { useState, useEffect, ReactNode } from 'react'
import { useAuth, useNavigate } from '@basicbenframework/core/client'
import { useTheme } from '../components/ThemeContext'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { Avatar } from '../components/Avatar'
import { Logo } from '../components/Logo'

interface Feature {
  icon: ReactNode
  title: string
  desc: string
}

interface Comparison {
  name: string
  issue: string
  highlight?: boolean
}

export function Home() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { t, dark } = useTheme()
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    fetch('https://registry.npmjs.org/@basicbenframework/core/latest')
      .then(res => res.json())
      .then(data => setVersion(data.version))
      .catch(() => {})
  }, [])

  const features: Feature[] = [
    {
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      ),
      title: 'Zero Dependencies',
      desc: 'No runtime deps. HTTP server, router, JWT, validation — all written from scratch using Node.js built-ins.'
    },
    {
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
      title: 'Laravel-Inspired DX',
      desc: 'Migrations, controllers, models, and scaffolding commands. Familiar conventions without the magic.'
    },
    {
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
        </svg>
      ),
      title: 'No Lock-in',
      desc: 'Just React, Node.js, and Vite. You own your stack. Eject anytime — your code is still your code.'
    },
    {
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      title: 'Escape Hatches',
      desc: 'Every convention can be overridden via basicben.config.js. Use what works, change what doesn\'t.'
    }
  ]

  const comparisons: Comparison[] = [
    { name: 'Next.js / Remix', issue: 'Too much magic, vendor lock-in' },
    { name: 'Express + Vite', issue: 'Wire everything yourself' },
    { name: 'BasicBen', issue: 'Conventions + control', highlight: true }
  ]

  const builtIns = [
    'JWT authentication',
    'Password hashing',
    'Request validation',
    'Database migrations',
    'Auto-loading routes',
    'CLI scaffolding'
  ]

  return (
    <div className="space-y-16 py-8">
      {/* Hero */}
      <section className="text-center">
        <div className="flex justify-center mb-6">
          <Logo className="w-16 h-16" />
        </div>
        <p className={`text-xs ${t.muted} mb-3 tracking-wide uppercase`}>Full-stack React Framework</p>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
          Ship faster with less
        </h1>
        <p className={`${t.muted} max-w-lg mx-auto mb-8 text-lg`}>
          A productive, convention-driven framework for React apps. Zero runtime dependencies. Maximum clarity.
        </p>
        <div className="flex flex-col items-center gap-4">
          <div className={`px-4 py-3 rounded-lg ${t.card} border ${t.border} font-mono text-sm`}>
            <span className={t.muted}>$</span> npx @basicbenframework/create my-app
          </div>
          <div className="flex gap-3">
            <Button onClick={() => navigate('/docs')}>Get Started</Button>
            <Button variant="secondary" onClick={() => window.open('https://github.com/BasicBenFramework/core', '_blank')}>
              GitHub
            </Button>
          </div>
        </div>
      </section>

      {/* The Problem */}
      <section>
        <h2 className={`text-center text-sm font-medium uppercase tracking-wider ${t.muted} mb-6`}>The Problem</h2>
        <Card>
          <div className="space-y-3">
            {comparisons.map(({ name, issue, highlight }) => (
              <div
                key={name}
                className={`flex items-center justify-between p-3 rounded-lg ${
                  highlight
                    ? `${dark ? 'bg-white/10' : 'bg-black/10'} border ${t.border}`
                    : ''
                }`}
              >
                <span className={`font-medium ${highlight ? '' : t.muted}`}>{name}</span>
                <span className={`text-sm ${highlight ? (dark ? 'text-green-400' : 'text-green-600') : t.muted}`}>
                  {highlight ? '✓ ' : ''}{issue}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* Features */}
      <section>
        <h2 className={`text-center text-sm font-medium uppercase tracking-wider ${t.muted} mb-6`}>Why BasicBen</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {features.map(({ icon, title, desc }) => (
            <Card key={title} className="hover:border-opacity-50 transition">
              <div className={`inline-flex p-2 rounded-lg ${t.card} border ${t.border} mb-3`}>
                {icon}
              </div>
              <h3 className="font-semibold mb-1">{title}</h3>
              <p className={`text-sm ${t.muted}`}>{desc}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Built-in */}
      <section>
        <h2 className={`text-center text-sm font-medium uppercase tracking-wider ${t.muted} mb-6`}>Batteries Included</h2>
        <Card>
          <p className={`text-sm ${t.muted} mb-4`}>
            Everything you need to build a production app, without pulling in a dozen packages.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {builtIns.map(item => (
              <div
                key={item}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg ${t.card} border ${t.border} text-sm`}
              >
                <svg className={`w-4 h-4 flex-shrink-0 ${dark ? 'text-green-400' : 'text-green-600'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* Code Example */}
      <section>
        <h2 className={`text-center text-sm font-medium uppercase tracking-wider ${t.muted} mb-6`}>Clean & Simple</h2>
        <Card>
          <div className={`rounded-lg p-4 font-mono text-sm ${dark ? 'bg-black/50' : 'bg-black/5'} border ${t.border} overflow-x-auto`}>
            <pre className={t.text}>{`// src/routes/posts.js
import { PostController } from '../controllers/PostController.js'
import { auth } from '../middleware/auth.js'

export default (router) => {
  router.get('/api/posts', PostController.index)
  router.post('/api/posts', auth, PostController.store)
  router.put('/api/posts/:id', auth, PostController.update)
  router.delete('/api/posts/:id', auth, PostController.destroy)
}`}</pre>
          </div>
          <p className={`text-sm ${t.muted} mt-3`}>
            Routes are auto-loaded. Controllers are plain objects. Middleware is just a function. No decorators, no magic.
          </p>
        </Card>
      </section>

      {/* Logged in user card */}
      {user && (
        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Avatar name={user.name} />
              <div>
                <p className="font-medium text-sm">{user.name}</p>
                <p className={`text-xs ${t.muted}`}>{user.email}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => navigate('/posts')} className="text-xs px-3 py-1.5">My Posts</Button>
              <Button variant="secondary" onClick={() => navigate('/profile')} className="text-xs px-3 py-1.5">Profile</Button>
            </div>
          </div>
        </Card>
      )}

      {/* Footer */}
      <footer className={`text-center text-xs ${t.muted} space-y-1`}>
        <p>Built with Node.js built-ins. Inspired by Laravel.</p>
        {version && <p>BasicBen v{version}</p>}
      </footer>
    </div>
  )
}
