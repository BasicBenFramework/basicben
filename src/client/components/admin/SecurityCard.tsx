import { useEffect, useState, FormEvent, ChangeEvent } from 'react'
import { api } from '../../../helpers/api.ts'
import { Card } from '../Card.tsx'
import { Input } from '../Input.tsx'
import { Button } from '../Button.tsx'
import { useTheme } from '../ThemeContext.tsx'
import { useToast } from '../../contexts/ToastContext.tsx'
import { useT } from '../../i18n/index.ts'
import { createPasskey, passkeyError, passkeysSupported } from '../../webauthn.ts'

interface TwoFactorStatus {
  totp: { enabled: boolean; enabledAt: string | null }
  recoveryCodesRemaining: number
}

interface Passkey {
  id: number
  label: string
  createdAt: string
  lastUsedAt: string | null
}

/** An action that needs the current password before the server will do it. */
type Pending =
  | { kind: 'setup' }
  | { kind: 'disable' }
  | { kind: 'rotate' }
  | { kind: 'add-passkey' }
  | { kind: 'remove-passkey'; id: number; label: string }

/**
 * Two-step verification for the signed-in account: an authenticator app (with
 * recovery codes) and passkeys. Either one makes sign-in ask for it after the
 * password. Every change asks for the current password again, which the
 * server requires.
 */
export function SecurityCard() {
  const { t } = useT()
  const { t: theme } = useTheme()
  const toast = useToast()

  const [status, setStatus] = useState<TwoFactorStatus | null>(null)
  const [passkeys, setPasskeys] = useState<Passkey[]>([])
  const [pending, setPending] = useState<Pending | null>(null)
  const [password, setPassword] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  // Enrolment in progress: the secret to type in, then the code that proves it.
  const [enrolment, setEnrolment] = useState<{ secret: string; uri: string } | null>(null)
  const [code, setCode] = useState('')
  // Shown once, straight after they are made.
  const [codes, setCodes] = useState<string[] | null>(null)

  const load = async () => {
    try {
      const [s, p] = await Promise.all([
        api.get<TwoFactorStatus>('/api/auth/2fa'),
        api.get<{ passkeys: Passkey[] }>('/api/auth/passkeys')
      ])
      setStatus(s)
      setPasskeys(p.passkeys)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  useEffect(() => { load() }, [])

  const ask = (next: Pending) => {
    setPending(next)
    setPassword('')
    setLabel('')
  }

  const confirm = async (e: FormEvent) => {
    e.preventDefault()
    if (!pending) return
    setBusy(true)
    try {
      if (pending.kind === 'setup') {
        setEnrolment(await api.post<{ secret: string; uri: string }>('/api/auth/2fa/totp/setup', { password }))
        setCode('')
      } else if (pending.kind === 'disable') {
        await api.delete('/api/auth/2fa/totp', { body: JSON.stringify({ password }) })
        setCodes(null)
        toast.success(t('Authenticator app removed.'))
      } else if (pending.kind === 'rotate') {
        const res = await api.post<{ recoveryCodes: string[] }>('/api/auth/2fa/recovery/rotate', { password })
        setCodes(res.recoveryCodes)
      } else if (pending.kind === 'add-passkey') {
        const { options, challengeHandle } = await api.post<{ options: unknown; challengeHandle: string }>('/api/auth/passkeys/options', { password })
        let response
        try {
          response = await createPasskey(options)
        } catch (err) {
          throw new Error(passkeyError(err))
        }
        await api.post('/api/auth/passkeys/verify', { challengeHandle, response, label: label.trim() || t('Passkey') })
        toast.success(t('Passkey added.'))
      } else if (pending.kind === 'remove-passkey') {
        await api.delete(`/api/auth/passkeys/${pending.id}`, { body: JSON.stringify({ password }) })
        toast.success(t('Passkey removed.'))
      }
      setPending(null)
      await load()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setPassword('')
      setBusy(false)
    }
  }

  const confirmCode = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await api.post<{ recoveryCodes: string[] }>('/api/auth/2fa/totp/confirm', { code: code.trim() })
      setEnrolment(null)
      setCodes(res.recoveryCodes)
      toast.success(t('Two-step verification is on.'))
      await load()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const download = () => {
    const blob = new Blob([`${t('Recovery codes')}\n\n${codes!.join('\n')}\n`], { type: 'text/plain' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'recovery-codes.txt'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : t('never'))
  const muted = `text-xs ${theme.muted}`
  const row = `flex items-center justify-between gap-3 py-2 border-t ${theme.border}`

  const pendingTitle: Record<Pending['kind'], string> = {
    'setup': t('Set up an authenticator app'),
    'disable': t('Turn off the authenticator app'),
    'rotate': t('Make new recovery codes'),
    'add-passkey': t('Add a passkey'),
    'remove-passkey': t('Remove a passkey')
  }

  return (
    <Card>
      <div className="space-y-4">
        <div>
          <h2 className="font-medium">{t('Two-step verification')}</h2>
          <p className={muted}>
            {t('With an authenticator app or a passkey, signing in asks for it after your password.')}
          </p>
        </div>

        {/* Authenticator app */}
        <div className={row}>
          <div>
            <div className="text-sm font-medium">{t('Authenticator app')}</div>
            <div className={muted}>
              {!status ? '…'
                : status.totp.enabled
                  ? t('On since {date}. {count} recovery codes left.', { date: date(status.totp.enabledAt), count: status.recoveryCodesRemaining })
                  : t('Off')}
            </div>
          </div>
          {status && (status.totp.enabled ? (
            <div className="flex gap-2 shrink-0">
              <Button type="button" variant="secondary" onClick={() => ask({ kind: 'rotate' })}>{t('New codes')}</Button>
              <Button type="button" variant="danger" onClick={() => ask({ kind: 'disable' })}>{t('Turn off')}</Button>
            </div>
          ) : !enrolment && (
            <Button type="button" className="shrink-0" onClick={() => ask({ kind: 'setup' })}>{t('Set up')}</Button>
          ))}
        </div>

        {enrolment && (
          <form onSubmit={confirmCode} className={`space-y-3 rounded-lg border ${theme.border} p-3`}>
            <p className="text-sm">{t('Add this account to your authenticator app, then enter the code it shows.')}</p>
            <div>
              <div className={muted}>{t('Setup key')}</div>
              <code className="block mt-1 text-sm font-mono break-all select-all">{enrolment.secret.match(/.{1,4}/g)?.join(' ')}</code>
            </div>
            {/* otpauth: is handed to whichever authenticator app is installed. */}
            <button type="button" onClick={() => { window.location.href = enrolment.uri }} className="block text-xs underline">
              {t('Open in an authenticator app on this device')}
            </button>
            <Input
              autoFocus
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="[0-9]{6}"
              placeholder={'000000'}
              value={code}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setCode(e.target.value.replace(/\D/g, ''))}
              className="font-mono tracking-[0.3em] text-center"
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>{busy ? '…' : t('Turn on')}</Button>
              <Button type="button" variant="ghost" onClick={() => setEnrolment(null)}>{t('Cancel')}</Button>
            </div>
          </form>
        )}

        {codes && (
          <div className={`space-y-3 rounded-lg border ${theme.border} p-3`}>
            <p className="text-sm font-medium">{t('Save your recovery codes')}</p>
            <p className={muted}>{t('Each works once, if you lose your phone. They will not be shown again.')}</p>
            <div className="grid grid-cols-2 gap-1 font-mono text-sm select-all">
              {codes.map((c) => <span key={c}>{c}</span>)}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => navigator.clipboard?.writeText(codes.join('\n')).then(() => toast.success(t('Copied.')))}>{t('Copy')}</Button>
              <Button type="button" variant="secondary" onClick={download}>{t('Download')}</Button>
              <Button type="button" variant="ghost" onClick={() => setCodes(null)}>{t('Done')}</Button>
            </div>
          </div>
        )}

        {/* Passkeys */}
        <div className={`border-t ${theme.border} pt-2`}>
          <div className="flex items-center justify-between gap-3 py-2">
            <div>
              <div className="text-sm font-medium">{t('Passkeys')}</div>
              <div className={muted}>
                {passkeysSupported() ? t('Your fingerprint, face or device screen lock.') : t('This browser does not support passkeys.')}
              </div>
            </div>
            {passkeysSupported() && (
              <Button type="button" className="shrink-0" onClick={() => ask({ kind: 'add-passkey' })}>{t('Add')}</Button>
            )}
          </div>
          {passkeys.map((p) => (
            <div key={p.id} className={row}>
              <div>
                <div className="text-sm">{p.label}</div>
                <div className={muted}>{t('Added {added} · last used {used}', { added: date(p.createdAt), used: date(p.lastUsedAt) })}</div>
              </div>
              <Button type="button" variant="ghost" onClick={() => ask({ kind: 'remove-passkey', id: p.id, label: p.label })}>{t('Remove')}</Button>
            </div>
          ))}
        </div>

        {pending && (
          <form onSubmit={confirm} className={`space-y-3 rounded-lg border ${theme.border} p-3`}>
            <p className="text-sm font-medium">
              {pendingTitle[pending.kind]}{pending.kind === 'remove-passkey' ? `: ${pending.label}` : ''}
            </p>
            {pending.kind === 'add-passkey' && (
              <Input placeholder={t('Name, such as “MacBook” or “Phone”')} value={label} maxLength={60} onChange={(e: ChangeEvent<HTMLInputElement>) => setLabel(e.target.value)} />
            )}
            <Input
              type="password"
              autoFocus
              required
              autoComplete="current-password"
              placeholder={t('Current password')}
              value={password}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={busy} variant={pending.kind === 'disable' || pending.kind === 'remove-passkey' ? 'danger' : 'primary'}>
                {busy ? '…' : t('Continue')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setPending(null)}>{t('Cancel')}</Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  )
}
