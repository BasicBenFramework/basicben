import { CSSProperties, ReactNode } from 'react'
import { useNavigate } from '@basicbenframework/core/client'
import { useTheme } from '../components/ThemeContext.tsx'
import { RootLayout } from './RootLayout.tsx'
import { DarkModeToggle } from '../components/Nav/DarkModeToggle.tsx'
import { SiteMark } from '../components/SiteMark.tsx'
import { accentVars, useBrandDocument, useSite } from '../hooks/useSite.ts'

/**
 * Sign-in, registration, password reset and invitations: one card on a
 * patterned backdrop, under the site's own logo, name and tagline
 * (Settings → Site Identity). The accent colour, when set, tints the
 * backdrop's glow and the primary button (`var(--accent)`).
 */
function AuthLayoutInner({ children }: { children: ReactNode }) {
  const { t, dark, setDark } = useTheme()
  const navigate = useNavigate()
  const site = useSite()
  useBrandDocument(site)

  const accent = site?.accent_color || (dark ? '#8b5cf6' : '#6366f1')
  const dot = dark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.13)'
  const backdrop: CSSProperties = {
    ...(accentVars(site) as CSSProperties),
    // Opaque, so the app's own purple and blue glows do not tint the accent.
    backgroundColor: dark ? '#000' : '#fff',
    backgroundImage: [
      `radial-gradient(ellipse 60% 45% at 50% 0%, ${accent}${dark ? '40' : '2e'}, transparent 70%)`,
      `radial-gradient(ellipse 45% 40% at 100% 100%, ${accent}${dark ? '26' : '1a'}, transparent 70%)`,
      `radial-gradient(${dot} 1.2px, transparent 1.4px)`
    ].join(', '),
    backgroundSize: '100% 100%, 100% 100%, 22px 22px'
  }

  const name = site?.site_name || 'BasicBen'

  return (
    <div className="relative min-h-screen flex flex-col" style={backdrop}>
      {/* The dots fade out towards the edges rather than stopping at them. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(ellipse at center, transparent 55%, ${dark ? '#000' : '#fff'} 100%)` }}
      />

      <header className="relative flex justify-end p-4">
        <DarkModeToggle dark={dark} setDark={setDark} />
      </header>

      <main className="relative flex-1 flex flex-col items-center justify-center px-4 pb-16">
        <button onClick={() => navigate('/')} className="flex flex-col items-center gap-3 mb-6 hover:opacity-80 transition" title={name}>
          <SiteMark site={site} className="w-12 h-12" />
          <span className="text-lg font-semibold tracking-tight">{name}</span>
        </button>
        {site?.login_tagline && (
          <p className={`-mt-3 mb-6 text-sm ${t.muted} text-center max-w-sm`}>{site.login_tagline}</p>
        )}

        <div
          className={`w-full max-w-sm rounded-2xl border ${t.border} px-7 py-2 shadow-2xl backdrop-blur-xl ${dark ? 'bg-neutral-950/70 shadow-black/50' : 'bg-white/80 shadow-black/10'}`}
        >
          {children}
        </div>
      </main>
    </div>
  )
}

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <RootLayout>
      <AuthLayoutInner>{children}</AuthLayoutInner>
    </RootLayout>
  )
}
