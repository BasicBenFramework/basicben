import { useState, ReactNode } from 'react'
import { ThemeContext } from '../components/ThemeContext'
import { ToastProvider } from '../contexts/ToastContext'

interface RootLayoutProps {
  children: ReactNode
}

export function RootLayout({ children }: RootLayoutProps) {
  const [dark, setDark] = useState(true)

  const t = dark
    ? { bg: 'bg-black', text: 'text-white', muted: 'text-white/50', subtle: 'text-white/30', border: 'border-white/10', card: 'bg-white/5', btn: 'bg-white text-black', btnHover: 'hover:bg-white/90', btnSecondary: 'bg-white/10 hover:bg-white/20' }
    : { bg: 'bg-white', text: 'text-black', muted: 'text-black/50', subtle: 'text-black/30', border: 'border-black/10', card: 'bg-black/5', btn: 'bg-black text-white', btnHover: 'hover:bg-black/90', btnSecondary: 'bg-black/10 hover:bg-black/20' }

  return (
    <ThemeContext.Provider value={{ t, dark, setDark }}>
      <ToastProvider>
        <div className={`min-h-screen ${t.bg} ${t.text} transition-colors duration-300`}>
          <div className="fixed inset-0 pointer-events-none overflow-hidden">
            <div className={`absolute top-0 right-0 w-[500px] h-[500px] rounded-full blur-[150px] ${dark ? 'bg-purple-500/10' : 'bg-purple-500/5'}`} />
            <div className={`absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full blur-[150px] ${dark ? 'bg-blue-500/10' : 'bg-blue-500/5'}`} />
          </div>
          <div className="relative">{children}</div>
        </div>
      </ToastProvider>
    </ThemeContext.Provider>
  )
}
