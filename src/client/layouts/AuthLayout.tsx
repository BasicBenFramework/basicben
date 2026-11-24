import { ReactNode } from 'react'
import { useNavigate } from '@basicbenframework/core/client'
import { useTheme } from '../components/ThemeContext.tsx'
import { RootLayout } from './RootLayout.tsx'
import { DarkModeToggle } from '../components/Nav/DarkModeToggle.tsx'
import { Logo } from '../components/Logo.tsx'

interface AuthLayoutInnerProps {
  children: ReactNode
}

function AuthLayoutInner({ children }: AuthLayoutInnerProps) {
  const { t, dark, setDark } = useTheme()
  const navigate = useNavigate()

  return (
    <div className="max-w-3xl mx-auto px-6">
      <nav className={`flex items-center justify-between h-14 border-b ${t.border}`}>
        <button onClick={() => navigate('/')} className="flex items-center gap-2 font-semibold hover:opacity-70 transition">
          <Logo className="w-6 h-6" />
          <span>BasicBen</span>
        </button>
        <DarkModeToggle dark={dark} setDark={setDark} />
      </nav>
      <main className="py-8 flex items-center justify-center min-h-[calc(100vh-3.5rem)]">
        {children}
      </main>
    </div>
  )
}

interface AuthLayoutProps {
  children: ReactNode
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <RootLayout>
      <AuthLayoutInner>{children}</AuthLayoutInner>
    </RootLayout>
  )
}
