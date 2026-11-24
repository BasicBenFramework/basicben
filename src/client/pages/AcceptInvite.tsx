import { useState, useEffect, FormEvent, ChangeEvent } from 'react'
import { useAuth, useNavigate, useParams } from '@basicbenframework/core/client'
import { useTheme } from '../components/ThemeContext.tsx'
import { Input } from '../components/Input.tsx'
import { Button } from '../components/Button.tsx'
import { api } from '../../helpers/api.ts'
import { useToast } from '../contexts/ToastContext.tsx'

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
  const { t } = useTheme()
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
      toast.success('Welcome aboard!')
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
        <h1 className="text-2xl font-bold mb-1">Invitation unavailable</h1>
        <p className={`text-sm ${t.muted} mb-6`}>{invalid} Ask whoever invited you to send another.</p>
        <button onClick={() => navigate('/login')} className="text-xs underline hover:no-underline">Go to sign in</button>
      </div>
    )
  }

  if (!info) {
    return <div className={`max-w-xs mx-auto py-8 text-center text-sm ${t.muted}`}>Loading…</div>
  }

  return (
    <div className="max-w-xs mx-auto py-8">
      <h1 className="text-2xl font-bold text-center mb-1">Join {info.siteName}</h1>
      <p className={`text-sm ${t.muted} text-center mb-6`}>
        You've been invited as {/^[aeiou]/i.test(info.role) ? 'an' : 'a'} {info.role}. Set up your account for {info.email}.
      </p>
      <form onSubmit={handleSubmit} className="space-y-3 mt-4">
        <Input type="email" value={info.email} disabled readOnly aria-label="Email" />
        <Input placeholder="Name" required minLength={2} value={form.name} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, name: e.target.value })} />
        <Input type="password" placeholder="Password" required minLength={8} autoComplete="new-password" value={form.password} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, password: e.target.value })} />
        <Button type="submit" disabled={loading} className="w-full">{loading ? '...' : 'Create account'}</Button>
      </form>
    </div>
  )
}
