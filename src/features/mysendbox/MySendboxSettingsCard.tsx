import { useEffect, useState } from 'react'
import { api } from '../../helpers/api'
import { useT } from '../../client/i18n'
import type { SettingsSectionProps } from '../../client/host'

const hint = { color: 'var(--fg-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }

interface Status {
  configured: boolean
  webhook: boolean
  audience_id: string | null
  contacts: Record<string, number>
  sendable: number | null
  problems: Array<{ member_id: number; state: string; last_error: string | null }>
  error: string | null
}

/**
 * MySendbox: where newsletters go, who is copied there, and the button that
 * copies the members who aren't yet. Saved with the rest of Settings, except
 * the copy, which runs at once.
 */
export default function MySendboxSettingsCard({ values, onChange }: SettingsSectionProps) {
  const { t } = useT()
  const [status, setStatus] = useState<Status | null>(null)
  const [copying, setCopying] = useState(false)
  const [message, setMessage] = useState('')

  const load = () => api.get<Status>('/api/mysendbox/status').then(setStatus).catch(() => setStatus(null))
  useEffect(() => { load() }, [])

  // Not set up, or not someone who manages members: say nothing.
  if (!status?.configured) return null

  const copy = async () => {
    setCopying(true)
    setMessage('')
    try {
      let copied = 0
      // One batch per request, so a large list fits a short function budget.
      for (let i = 0; i < 200; i++) {
        const res = await api.post<{ done: Record<string, number>; remaining: number }>('/api/mysendbox/backfill', {})
        copied += res?.done?.synced ?? 0
        if (!res || res.remaining === 0) break
      }
      setMessage(t('{count} member(s) copied.', { count: copied }))
    } catch (err: any) {
      setMessage(err.message || t('The copy stopped.'))
    } finally {
      setCopying(false)
      load()
    }
  }

  const c = status.contacts
  const field = (key: string, label: string, help: string, type = 'text') => (
    <div className="admin-form-group">
      <label className="admin-label" htmlFor={key}>{label}</label>
      {type === 'textarea' ? (
        <textarea id={key} rows={3} value={values[key] ?? ''} onChange={e => onChange({ [key]: e.target.value })} className="admin-input" />
      ) : (
        <input id={key} type={type} value={values[key] ?? ''} onChange={e => onChange({ [key]: e.target.value })} className="admin-input" />
      )}
      <p style={hint}>{help}</p>
    </div>
  )

  return (
    <div className="admin-card">
      <h3 className="admin-card-title">{t('Newsletters through MySendbox')}</h3>

      <p style={hint}>
        {t('{synced} member(s) in MySendbox, {waiting} waiting for consent, {refused} refused.', {
          synced: c.synced ?? 0, waiting: c.needs_consent ?? 0, refused: c.refused ?? 0
        })}{' '}
        {status.sendable !== null && t('A broadcast would reach {count} now.', { count: status.sendable })}
        {!status.webhook && <> {t('No webhook secret: unsubscribes made in MySendbox arrive through the daily check.')}</>}
      </p>
      {status.error && <p style={{ ...hint, color: 'var(--danger, #b00)' }}>{status.error}</p>}

      {field('mysendbox_from_address', t('From address'), t("Blank uses your MySendbox workspace's default sender."), 'email')}
      {field('mysendbox_from_name', t('From name'), t('Blank uses the newsletter sender name.'))}
      {field('mysendbox_consent_attestation', t('Consent for members you added or imported'),
        t('How they agreed to receive posts by email, in your words. MySendbox records it with each contact. Leave blank and they are not copied, unless a signup form is set.'), 'textarea')}
      {field('mysendbox_form_id', t('Signup form (frm_…)'),
        t('Optional. Members without recorded consent are sent this form’s confirmation email instead.'))}
      {field('mysendbox_audience_id', t('Audience (aud_…)'), t('Made for you on first use. Change it only to use another MySendbox list.'))}

      <div className="admin-form-group">
        <button type="button" className="admin-btn admin-btn-secondary" disabled={copying} onClick={copy}>
          {copying ? t('Copying…') : t('Copy members to MySendbox')}
        </button>
        <p style={hint}>{message || t('Copies every subscribed member not yet in MySendbox. Safe to run again. Save settings first if you changed consent.')}</p>
      </div>

      {status.problems.length > 0 && (
        <details>
          <summary>{t('Members not copied ({count})', { count: status.problems.length })}</summary>
          <ul style={hint}>
            {status.problems.map(p => <li key={p.member_id}>#{p.member_id} — {p.last_error || p.state}</li>)}
          </ul>
        </details>
      )}
    </div>
  )
}
