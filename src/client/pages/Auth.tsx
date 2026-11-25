import { useState, FormEvent, ChangeEvent } from 'react'
import { useAuth, useNavigate, usePath } from '@basicbenframework/core/client'
import { useTheme } from '../components/ThemeContext.tsx'
import { Input } from '../components/Input.tsx'
import { api } from '../../helpers/api.ts'
import { useToast } from '../contexts/ToastContext.tsx'
import { useRegistrationOpen } from '../hooks/useRegistrationOpen.ts'
import { useSite } from '../hooks/useSite.ts'
import { passkeysSupported, passkeyError, signWithPasskey } from '../webauthn.ts'

interface AuthResponse {
  token: string
  user: {
    id: number
    name: string
    email: string
  }
  recoveryCodeUsed?: boolean
  recoveryCodesRemaining?: number
}

/** What a correct password gets when the account has a second factor. */
interface SecondStep {
  challenge: string
  /** 'passkey', 'totp', 'recovery' — what this account has enrolled. */
  methods: string[]
}

type LoginResponse = AuthResponse | ({ twoFactorRequired: true } & SecondStep)

export function Auth() {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const path = usePath()
  const { t } = useTheme()
  const toast = useToast()
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [loading, setLoading] = useState(false)
  // Set once the password is right and a second factor is still needed.
  const [second, setSecond] = useState<SecondStep | null>(null)
  const [code, setCode] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const isLogin = path === '/login'
  const registrationOpen = useRegistrationOpen()
  const site = useSite()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register'
      const data = await api<LoginResponse>(endpoint, {
        method: 'POST',
        body: JSON.stringify(isLogin ? { email: form.email, password: form.password } : form)
      })
      // The password was right, but it is not a session on its own.
      if ('twoFactorRequired' in data) {
        setSecond({ challenge: data.challenge, methods: data.methods })
        setCode('')
        setUseRecovery(!data.methods.includes('totp') && data.methods.includes('recovery'))
        return
      }
      finish(data, isLogin ? 'Welcome back!' : 'Account created!')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const finish = (data: AuthResponse, message: string) => {
    localStorage.setItem('token', data.token)
    setUser(data.user)
    toast.success(message)
    if (data.recoveryCodeUsed) {
      toast.error(`Recovery code used. ${data.recoveryCodesRemaining ?? 0} left — make new ones in Profile.`)
    }
    navigate('/')
  }

  /** Back to the password: a spent or expired challenge cannot be retried. */
  const startOver = (message?: string) => {
    setSecond(null)
    setCode('')
    setForm({ ...form, password: '' })
    if (message) toast.error(message)
  }

  const submitCode = async (e: FormEvent) => {
    e.preventDefault()
    if (!second) return
    setLoading(true)
    try {
      // fetch rather than api(): a wrong code's refusal carries the fresh
      // challenge to try again with, which api() would throw away.
      const res = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge: second.challenge, code: code.trim() })
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) return finish(data as AuthResponse, 'Welcome back!')

      if (data.challenge) {
        setSecond({ ...second, challenge: data.challenge })
        setCode('')
        toast.error(data.error || 'That code is not right.')
      } else {
        // Locked, expired or spent: only the password again gets a new
        // challenge.
        startOver(data.error || 'That sign-in attempt has expired. Please start again.')
      }
    } catch {
      toast.error('Unable to connect to server')
    } finally {
      setLoading(false)
    }
  }

  const submitPasskey = async () => {
    if (!second) return
    setLoading(true)
    try {
      // Asking for the options spends the login challenge, so a failure from
      // here on means signing in again.
      const { options, challengeHandle } = await api<{ options: unknown; challengeHandle: string }>('/api/auth/passkey/options', {
        method: 'POST',
        body: JSON.stringify({ challenge: second.challenge })
      })
      let response
      try {
        response = await signWithPasskey(options)
      } catch (err) {
        startOver(`${passkeyError(err)} Sign in again to retry.`)
        return
      }
      const data = await api<AuthResponse>('/api/auth/2fa/verify', {
        method: 'POST',
        body: JSON.stringify({ challengeHandle, response })
      })
      finish(data, 'Welcome back!')
    } catch (err) {
      startOver((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  // The accent colour when the site has one (AuthLayout sets the variable),
  // otherwise the theme's own button colours.
  const primary = { background: 'var(--accent, currentColor)', color: 'var(--accent-fg, inherit)' }
  const label = `block text-xs font-medium mb-1.5 ${t.muted}`

  if (second) {
    const hasPasskey = second.methods.includes('passkey') && passkeysSupported()
    const hasCode = second.methods.includes('totp') || second.methods.includes('recovery')

    return (
      <div className="py-6">
        <h1 className="text-xl font-semibold text-center">Two-step verification</h1>
        <p className={`text-sm ${t.muted} text-center mt-1`}>
          {hasCode
            ? useRecovery ? 'Enter one of your recovery codes.' : 'Enter the 6-digit code from your authenticator app.'
            : 'Confirm it\'s you with your passkey.'}
        </p>

        {hasPasskey && (
          <button
            type="button"
            onClick={submitPasskey}
            disabled={loading}
            className={`w-full mt-6 rounded-lg py-2.5 text-sm font-semibold transition hover:opacity-90 disabled:opacity-50 ${hasCode ? `border ${t.border}` : t.btn}`}
            style={!hasCode && site?.accent_color ? primary : undefined}
          >
            {loading ? 'Waiting for your passkey…' : 'Use a passkey'}
          </button>
        )}

        {hasPasskey && hasCode && (
          <div className={`flex items-center gap-3 my-5 text-xs ${t.muted}`}>
            <span className={`flex-1 border-t ${t.border}`} />or<span className={`flex-1 border-t ${t.border}`} />
          </div>
        )}

        {hasCode && (
          <form onSubmit={submitCode} className={`space-y-4 ${hasPasskey ? '' : 'mt-6'}`}>
            <div>
              <label htmlFor="auth-code" className={label}>{useRecovery ? 'Recovery code' : 'Authentication code'}</label>
              <Input
                id="auth-code"
                autoFocus
                required
                autoComplete="one-time-code"
                inputMode={useRecovery ? 'text' : 'numeric'}
                maxLength={useRecovery ? 32 : 6}
                pattern={useRecovery ? undefined : '[0-9]{6}'}
                value={code}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, ''))}
                className={`py-2.5 text-center tracking-[0.3em] ${useRecovery ? '' : 'text-lg font-mono'}`}
                placeholder={useRecovery ? 'xxxx-xxxx' : '000000'}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className={`w-full rounded-lg py-2.5 text-sm font-semibold transition hover:opacity-90 disabled:opacity-50 ${t.btn}`}
              style={site?.accent_color ? primary : undefined}
            >
              {loading ? 'Checking…' : 'Verify'}
            </button>
            {second.methods.includes('totp') && second.methods.includes('recovery') && (
              <button type="button" onClick={() => { setUseRecovery(!useRecovery); setCode('') }} className={`block mx-auto text-xs ${t.muted} hover:underline`}>
                {useRecovery ? 'Use your authenticator app instead' : 'Lost your phone? Use a recovery code'}
              </button>
            )}
          </form>
        )}

        <p className={`text-sm ${t.muted} text-center mt-6 pt-5 border-t ${t.border}`}>
          <button type="button" onClick={() => startOver()} className="hover:underline">Back to sign in</button>
        </p>
      </div>
    )
  }

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
