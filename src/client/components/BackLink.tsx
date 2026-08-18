import { ReactNode } from 'react'
import { useTheme } from './ThemeContext'

interface BackLinkProps {
  onClick: () => void
  children: ReactNode
}

export function BackLink({ onClick, children }: BackLinkProps) {
  const { t } = useTheme()
  return (
    <button onClick={onClick} className={`text-sm ${t.muted} mb-4 hover:underline`}>
      &larr; {children}
    </button>
  )
}
