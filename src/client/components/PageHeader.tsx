import { ReactNode } from 'react'
import { useTheme } from './ThemeContext'

interface PageHeaderProps {
  title: string
  subtitle?: string
  action?: ReactNode
}

export function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  const { t } = useTheme()

  return (
    <div className="flex items-start justify-between mb-6 gap-4">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className={`text-sm mt-1 ${t.muted}`}>{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}
