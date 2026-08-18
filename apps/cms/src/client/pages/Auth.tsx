import { useState, FormEvent, ChangeEvent } from 'react'
import { useAuth, useNavigate, usePath } from '@basicbenframework/core/client'
import { useTheme } from '../components/ThemeContext'
import { Input } from '../components/Input'
import { Button } from '../components/Button'
import { api } from '../../helpers/api'
import { useToast } from '../contexts/ToastContext'

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

  return (
    <div className="max-w-xs mx-auto py-8">
      <h1 className="text-2xl font-bold text-center mb-1">{isLogin ? 'Welcome back' : 'Create account'}</h1>
      <p className={`text-sm ${t.muted} text-center mb-6`}>{isLogin ? 'Sign in to continue' : 'Get started for free'}</p>
      <form onSubmit={handleSubmit} className="space-y-3 mt-4">
        {!isLogin && <Input placeholder="Name" required value={form.name} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, name: e.target.value })} />}
        <Input type="email" placeholder="Email" required value={form.email} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, email: e.target.value })} />
        <Input type="password" placeholder="Password" required minLength={8} value={form.password} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, password: e.target.value })} />
        <Button type="submit" disabled={loading} className="w-full">{loading ? '...' : isLogin ? 'Sign in' : 'Create account'}</Button>
      </form>
      <p className={`text-xs ${t.muted} text-center mt-4`}>
        {isLogin ? "Don't have an account? " : 'Have an account? '}
        <button onClick={() => navigate(isLogin ? '/register' : '/login')} className="underline hover:no-underline">{isLogin ? 'Sign up' : 'Sign in'}</button>
      </p>
    </div>
  )
}
