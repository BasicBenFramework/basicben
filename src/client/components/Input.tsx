import { InputHTMLAttributes } from 'react'
import { useTheme } from './ThemeContext'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  type?: string
}

export function Input({ type = 'text', className = '', ...props }: InputProps) {
  const { t } = useTheme()
  return (
    <input
      type={type}
      className={`w-full px-3 py-2 text-sm rounded-lg ${t.card} border ${t.border} focus:outline-none ${className}`}
      {...props}
    />
  )
}
