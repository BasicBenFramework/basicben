import { useTheme } from './ThemeContext'

export function PageHeader({ title, subtitle, action }) {
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
