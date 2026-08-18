import { TextareaHTMLAttributes } from 'react'
import { useTheme } from './ThemeContext'

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  rows?: number
}

export function Textarea({ rows = 5, className = '', ...props }: TextareaProps) {
  const { t } = useTheme()
  return (
    <textarea
      rows={rows}
      className={`w-full px-3 py-2 text-sm rounded-lg ${t.card} border ${t.border} focus:outline-none resize-none ${className}`}
      {...props}
    />
  )
}
