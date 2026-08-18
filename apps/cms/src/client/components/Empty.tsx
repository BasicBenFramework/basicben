import { ReactNode } from 'react'
import { useTheme } from './ThemeContext'

interface EmptyProps {
  children: ReactNode
}

export function Empty({ children }: EmptyProps) {
  const { t } = useTheme()
  return <p className={`text-center ${t.muted} py-12`}>{children}</p>
}
