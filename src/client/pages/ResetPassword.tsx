import { useState, FormEvent, ChangeEvent } from 'react'
import { useAuth, useNavigate, useParams } from '@basicbenframework/core/client'
import { useTheme } from '../components/ThemeContext.tsx'
import { Input } from '../components/Input.tsx'
import { Button } from '../components/Button.tsx'
import { api } from '../../helpers/api.ts'
import { useToast } from '../contexts/ToastContext.tsx'
import { useT } from '../i18n/index.ts'

interface ResetResponse {
  message: string
  /** Present unless the account has a second factor. */
  token?: string
  user?: { id: number; name: string; email: string }
  /** Set when the account has 2FA or a passkey: the link alone is not a sign-in. */
  signInRequired?: boolean
}

/**
 * Choose a new password from an emailed link.
 *
 * Signs straight in when the server hands back a session. An account with a
 * second factor gets no session from a reset — the mailbox is one factor —
 * so it is sent to sign in, where the second factor is asked for as usual.
 */
export function ResetPassword() {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const params = useParams()
  const { t: theme } = useTheme()
  const { t } = useT()
  const toast = useToast()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== confirmation) {
      toast.error(t('The passwords do not match.'))
      return
    }

    setLoading(true)
    try {
      const data = await api.post<ResetResponse>('/api/auth/reset-password', { token: params.token, password })

      if (data.token && data.user) {
        localStorage.setItem('token', data.token)
        setUser(data.user)
        toast.success(data.message)
        navigate('/')
        return
      }

      toast.success(data.message)
      navigate('/login')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-xs mx-auto py-8">
      <h1 className="text-2xl font-bold text-center mb-1">{t('Choose a new password')}</h1>
      <p className={`text-sm ${theme.muted} text-center mb-6`}>{t('This signs you out on every other device')}</p>
      <form onSubmit={handleSubmit} className="space-y-3 mt-4">
        <Input type="password" placeholder={t('New password')} required minLength={8} autoComplete="new-password" value={password} onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} />
        <Input type="password" placeholder={t('Confirm new password')} required minLength={8} autoComplete="new-password" value={confirmation} onChange={(e: ChangeEvent<HTMLInputElement>) => setConfirmation(e.target.value)} />
        <Button type="submit" disabled={loading} className="w-full">{loading ? '…' : t('Set password')}</Button>
      </form>
      <p className={`text-xs ${theme.muted} text-center mt-4`}>
        <button onClick={() => navigate('/forgot-password')} className="underline hover:no-underline">{t('Need a new link?')}</button>
      </p>
    </div>
  )
}
