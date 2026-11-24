import { useState, FormEvent, ChangeEvent } from 'react'
import { useNavigate } from '@basicbenframework/core/client'
import { useTheme } from '../components/ThemeContext.tsx'
import { Input } from '../components/Input.tsx'
import { Button } from '../components/Button.tsx'
import { api } from '../../helpers/api.ts'
import { useToast } from '../contexts/ToastContext.tsx'

/**
 * Ask for a password reset link.
 *
 * The server gives the same answer for every address, so this page does too:
 * it shows the server's message and nothing else. Saying "check your inbox"
 * only when the account exists would undo the point.
 */
export function ForgotPassword() {
  const navigate = useNavigate()
  const { t } = useTheme()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const data = await api.post<{ message: string }>('/api/auth/forgot-password', { email })
      setSent(data.message)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-xs mx-auto py-8">
      <h1 className="text-2xl font-bold text-center mb-1">Reset your password</h1>
      {sent ? (
        <p className={`text-sm ${t.muted} text-center mb-6`}>{sent}</p>
      ) : (
        <>
          <p className={`text-sm ${t.muted} text-center mb-6`}>We'll email you a link to choose a new one</p>
          <form onSubmit={handleSubmit} className="space-y-3 mt-4">
            <Input type="email" placeholder="Email" required value={email} onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} />
            <Button type="submit" disabled={loading} className="w-full">{loading ? '...' : 'Send reset link'}</Button>
          </form>
        </>
      )}
      <p className={`text-xs ${t.muted} text-center mt-4`}>
        <button onClick={() => navigate('/login')} className="underline hover:no-underline">Back to sign in</button>
      </p>
    </div>
  )
}
