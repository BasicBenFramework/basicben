import { ReactNode } from 'react'
import { useTheme } from './ThemeContext'

interface CardProps {
  children: ReactNode
  className?: string
}

export function Card({ children, className = '' }: CardProps) {
  const { t } = useTheme()
  return (
    <div className={`p-4 rounded-xl ${t.card} border ${t.border} ${className}`}>
      {children}
    </div>
  )
}
