import { ReactNode } from 'react'
import { useTheme } from './ThemeContext'

interface NavLinkProps {
  onClick: () => void
  children: ReactNode
  className?: string
}

export function NavLink({ onClick, children, className = '' }: NavLinkProps) {
  const { t } = useTheme()
  return (
    <button onClick={onClick} className={`text-sm ${t.muted} hover:opacity-70 transition ${className}`}>
      {children}
    </button>
  )
}
