import React from 'react'
import { useT, slots } from '../../i18n/index.ts'

/** Where a configurable value comes from, as `GET /api/settings` reports it (helpers/config.ts). */
export interface ConfigStatus {
  env: string
  setting: string
  label: string
  group: string
  secret: boolean
  source: 'env' | 'settings' | 'unset' | 'unreadable'
  locked_by: string | null
  value: string | null
}

const hint = { color: 'var(--fg-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }

interface Props {
  name: string
  label: string
  help?: React.ReactNode
  value: string
  onChange(value: string): void
  /** This setting's entry from `config`; absent for a plain setting. */
  status?: ConfigStatus
  /** For a secret: whether one is saved. */
  saved?: boolean
  placeholder?: string
}

/**
 * A setting the environment can also set.
 *
 * - Set by the environment: shown disabled, with the variable named. The
 *   value in use is shown unless it is a secret.
 * - Secret: a password field that starts blank. The saved value never reaches
 *   the browser; leaving the field blank keeps it.
 */
export function ConfigField({ name, label, help, value, onChange, status, saved, placeholder }: Props) {
  const { t } = useT()
  const locked = status?.locked_by
  const secret = Boolean(status?.secret)

  let shown = value
  let hold = placeholder
  if (locked) {
    shown = secret ? '' : status?.value ?? ''
    hold = secret ? t('Set in the environment') : hold
  } else if (secret && saved) {
    hold = t('Saved. Leave blank to keep it.')
  }

  return (
    <div className="admin-form-group">
      <label className="admin-label" htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        type={secret ? 'password' : 'text'}
        autoComplete={secret ? 'new-password' : 'off'}
        value={shown}
        onChange={(e) => onChange(e.target.value)}
        className="admin-input"
        placeholder={hold}
        disabled={Boolean(locked)}
      />
      {locked ? (
        <p style={hint}>{slots(t('Set by {variable} in the environment, which wins over this setting.'), { variable: <code>{locked}</code> })}</p>
      ) : status?.source === 'unreadable' ? (
        <p style={{ ...hint, color: 'var(--danger)' }}>{t('The saved value cannot be read. APP_KEY has changed since it was saved; enter it again.')}</p>
      ) : (
        help && <p style={hint}>{help}</p>
      )}
    </div>
  )
}
