import { ReactNode } from 'react'

interface AlertProps {
  type?: 'error' | 'success'
  children: ReactNode
}

export function Alert({ type = 'error', children }: AlertProps) {
  const styles = {
    error: 'text-red-500 bg-red-500/10',
    success: 'text-emerald-500 bg-emerald-500/10'
  }
  return (
    <p className={`text-xs p-2 rounded-lg ${styles[type]}`}>
      {children}
    </p>
  )
}
