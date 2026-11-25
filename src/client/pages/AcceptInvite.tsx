import { useState, useEffect, FormEvent, ChangeEvent } from 'react'
import { useAuth, useNavigate, useParams } from '@basicbenframework/core/client'
import { useTheme } from '../components/ThemeContext.tsx'
import { Input } from '../components/Input.tsx'
import { Button } from '../components/Button.tsx'
import { api } from '../../helpers/api.ts'
import { useToast } from '../contexts/ToastContext.tsx'
import { useT } from '../i18n/index.ts'

interface InvitationInfo {
  email: string
  name: string | null
  role: string
  siteName: string
}

interface AuthResponse {
  token: string
  user: { id: number; name: string; email: string }
}

/**
 * Accept an invitation: the address is fixed, the name and password are theirs.
 *
 * Reachable whatever DISABLE_REGISTRATION and DISABLE_PUBLIC_SITE say — on a
 * closed site this is the only way a new person gets an account, and it is an
 * admin who opened the door.
 */
export function AcceptInvite() {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const params = useParams()
  const { t: theme } = useTheme()
  const { t } = useT()

  // The built-in roles by name, as the Users screen shows them; a role the
  // server adds later shows as it is.
  const ROLE_LABELS: Record<string, string> = {
    admin: t('Admin'),
    editor: t('Editor'),
    author: t('Author'),
    contributor: t('Contributor'),
    subscriber: t('Subscriber')
  }
  const toast = useToast()
  const [info, setInfo] = useState<InvitationInfo | null>(null)
  const [invalid, setInvalid] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', password: '' })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.get<InvitationInfo>(`/api/invitations/${encodeURIComponent(params.token ?? '')}`)
      .then((data) => {
        setInfo(data)
        setForm((current) => ({ ...current, name: data.name ?? '' }))
      })
      .catch((err) => setInvalid((err as Error).message))
  }, [params.token])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const data = await api.post<AuthResponse>(
        `/api/invitations/${encodeURIComponent(params.token ?? '')}/accept`,
        form
      )
      // Stored exactly as sign-in stores it, so the rest of the app cannot
      // tell an accepted invitation from a login.
      localStorage.setItem('token', data.token)
      setUser(data.user)
      toast.success(t('Welcome aboard!'))
      navigate('/admin')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  if (invalid) {
    return (
      <div className="max-w-xs mx-auto py-8 text-center">
        <h1 className="text-2xl font-bold mb-1">{t('Invitation unavailable')}</h1>
        <p className={`text-sm ${theme.muted} mb-6`}>{invalid} {t('Ask whoever invited you to send another.')}</p>
        <button onClick={() => navigate('/login')} className="text-xs underline hover:no-underline">{t('Go to sign in')}</button>
      </div>
    )
  }

  if (!info) {
    return <div className={`max-w-xs mx-auto py-8 text-center text-sm ${theme.muted}`}>{t('Loading…')}</div>
  }

  return (
    <div className="max-w-xs mx-auto py-8">
      <h1 className="text-2xl font-bold text-center mb-1">{t('Join {site}', { site: info.siteName })}</h1>
      <p className={`text-sm ${theme.muted} text-center mb-6`}>
        {t('You’ve been invited with the {role} role. Set up your account for {email}.', { role: ROLE_LABELS[info.role] ?? info.role, email: info.email })}
      </p>
      <form onSubmit={handleSubmit} className="space-y-3 mt-4">
        <Input type="email" value={info.email} disabled readOnly aria-label={t('Email')} />
        <Input placeholder={t('Name')} required minLength={2} value={form.name} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, name: e.target.value })} />
        <Input type="password" placeholder={t('Password')} required minLength={8} autoComplete="new-password" value={form.password} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, password: e.target.value })} />
        <Button type="submit" disabled={loading} className="w-full">{loading ? '…' : t('Create account')}</Button>
      </form>
    </div>
  )
}
