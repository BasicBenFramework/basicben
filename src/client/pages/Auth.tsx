import { useState, FormEvent, ChangeEvent } from 'react'
import { useAuth, useNavigate, usePath } from '@basicbenframework/core/client'
import { useTheme } from '../components/ThemeContext.tsx'
import { Input } from '../components/Input.tsx'
import { api } from '../../helpers/api.ts'
import { useToast } from '../contexts/ToastContext.tsx'
import { useRegistrationOpen } from '../hooks/useRegistrationOpen.ts'
import { useSite } from '../hooks/useSite.ts'

interface AuthResponse {
  token: string
  user: {
    id: number
    name: string
    email: string
  }
}

export function Auth() {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const path = usePath()
  const { t } = useTheme()
  const toast = useToast()
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const isLogin = path === '/login'
  const registrationOpen = useRegistrationOpen()
  const site = useSite()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register'
      const data = await api<AuthResponse>(endpoint, {
        method: 'POST',
        body: JSON.stringify(isLogin ? { email: form.email, password: form.password } : form)
      })
      localStorage.setItem('token', data.token)
      setUser(data.user)
      toast.success(isLogin ? 'Welcome back!' : 'Account created!')
      navigate('/')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  // The accent colour when the site has one (AuthLayout sets the variable),
  // otherwise the theme's own button colours.
  const primary = { background: 'var(--accent, currentColor)', color: 'var(--accent-fg, inherit)' }
  const label = `block text-xs font-medium mb-1.5 ${t.muted}`

  return (
    <div className="py-6">
      <h1 className="text-xl font-semibold text-center">{isLogin ? 'Welcome back' : 'Create your account'}</h1>
      <p className={`text-sm ${t.muted} text-center mt-1`}>{isLogin ? 'Sign in to continue' : 'It only takes a minute'}</p>

      <form onSubmit={handleSubmit} className="space-y-4 mt-6">
        {!isLogin && (
          <div>
            <label htmlFor="auth-name" className={label}>Name</label>
            <Input id="auth-name" autoComplete="name" required value={form.name} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, name: e.target.value })} className="py-2.5" />
          </div>
        )}
        <div>
          <label htmlFor="auth-email" className={label}>Email</label>
          <Input id="auth-email" type="email" autoComplete="email" required value={form.email} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, email: e.target.value })} className="py-2.5" />
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="auth-password" className={label}>Password</label>
            {/* Offered whatever DISABLE_REGISTRATION says: a closed site still has
                people with accounts who forget their passwords. */}
            {isLogin && (
              <button type="button" onClick={() => navigate('/forgot-password')} className={`text-xs ${t.muted} hover:underline`}>Forgot password?</button>
            )}
          </div>
          <Input id="auth-password" type="password" autoComplete={isLogin ? 'current-password' : 'new-password'} required minLength={8} value={form.password} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, password: e.target.value })} className="py-2.5" />
          {!isLogin && <p className={`text-xs ${t.muted} mt-1.5`}>At least 8 characters.</p>}
        </div>
        <button
          type="submit"
          disabled={loading}
          className={`w-full rounded-lg py-2.5 text-sm font-semibold transition hover:opacity-90 disabled:opacity-50 ${t.btn}`}
          style={site?.accent_color ? primary : undefined}
        >
          {loading ? (isLogin ? 'Signing in…' : 'Creating account…') : isLogin ? 'Sign in' : 'Create account'}
        </button>
      </form>

      {/* With registration closed there is nothing to offer someone without an
          account, and inviting them to sign up would be a dead end. */}
      {registrationOpen && (
        <p className={`text-sm ${t.muted} text-center mt-6 pt-5 border-t ${t.border}`}>
          {isLogin ? "Don't have an account? " : 'Already have an account? '}
          <button onClick={() => navigate(isLogin ? '/register' : '/login')} className="font-medium underline-offset-4 hover:underline" style={{ color: 'inherit' }}>{isLogin ? 'Sign up' : 'Sign in'}</button>
        </p>
      )}
    </div>
  )
}
