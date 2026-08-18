import { useTheme } from './ThemeContext'

export function Loading() {
  const { t } = useTheme()
  return <div className={`text-center ${t.muted} py-12`}>Loading...</div>
}
