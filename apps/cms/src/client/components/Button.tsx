import { ButtonHTMLAttributes, ReactNode } from 'react'
import { useTheme } from './ThemeContext'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  children: ReactNode
}

export function Button({ variant = 'primary', children, className = '', ...props }: ButtonProps) {
  const { t } = useTheme()
  const styles = {
    primary: `${t.btn} ${t.btnHover}`,
    secondary: t.btnSecondary,
    danger: 'bg-red-500/10 text-red-500 hover:bg-red-500/20',
    ghost: `${t.muted} hover:opacity-70`
  }
  return (
    <button
      className={`text-sm font-medium rounded-full px-4 py-2 transition disabled:opacity-50 ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
