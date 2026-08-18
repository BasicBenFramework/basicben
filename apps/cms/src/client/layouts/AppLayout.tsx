import { useState, ReactNode } from 'react'
import { useAuth, useNavigate } from '@basicbenframework/core/client'
import { useTheme } from '../components/ThemeContext'
import { RootLayout } from './RootLayout'
import { DesktopNav } from '../components/Nav/DesktopNav'
import { MobileNav } from '../components/Nav/MobileNav'
import { DarkModeToggle } from '../components/Nav/DarkModeToggle'
import { Logo } from '../components/Logo'

interface AppLayoutInnerProps {
  children: ReactNode
}

function AppLayoutInner({ children }: AppLayoutInnerProps) {
  const { t, dark, setDark } = useTheme()
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <div className="max-w-3xl mx-auto px-6">
      <nav className={`flex items-center justify-between h-14 border-b ${t.border} relative`}>
        <button onClick={() => navigate('/')} className="flex items-center gap-2 font-semibold hover:opacity-70 transition">
          <Logo className="w-6 h-6" />
          <span>BasicBen</span>
        </button>
        <DesktopNav user={user} navigate={navigate} logout={logout} />

        {/* Mobile Navigation Trigger */}
        <div className="flex sm:hidden items-center gap-2">
          <DarkModeToggle dark={dark} setDark={setDark} />
          <button
            onClick={() => setMobileMenuOpen(true)}
            className={`p-2 rounded-lg ${t.card} transition`}
            aria-label="Open menu"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </nav>

      <main className="py-8">{children}</main>

      {mobileMenuOpen && (
        <MobileNav
          user={user}
          navigate={navigate}
          onClose={() => setMobileMenuOpen(false)}
          logout={logout}
        />
      )}
    </div>
  )
}

interface AppLayoutProps {
  children: ReactNode
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <RootLayout>
      <AppLayoutInner>{children}</AppLayoutInner>
    </RootLayout>
  )
}
