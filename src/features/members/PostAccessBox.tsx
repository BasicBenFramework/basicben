import { useEffect, useState } from 'react'
import { api } from '../../helpers/api.ts'
import { useT } from '../../client/i18n/index.ts'
import type { PostEditorSidebarProps } from '../../client/host/index.ts'

/**
 * Who may read a post, and whether it is emailed to members.
 *
 * Its own component so the editor gains one line rather than a panel's worth
 * of state — the editor is the file every workstream touches.
 *
 * The newsletter checkbox is a *request*: the post is mailed once, when it is
 * live, and the server decides whether this account may ask (editors and
 * admins). Once a send exists the checkbox is replaced by its progress,
 * because unticking it then would promise something that cannot happen.
 */

export type Visibility = 'public' | 'members' | 'paid'

interface NewsletterSend {
  status: 'preparing' | 'sending' | 'sent' | 'handing_off' | 'handed_off' | 'handoff_failed'
  provider?: string | null
  handoff_error?: string | null
  total_count: number
  sent_count: number
  failed_count: number
  skipped_count: number
  completed_at: string | null
}

/** What a provider that took the send says about it (`newsletter.status`). */
interface ProviderStatus {
  name: string
  status: string
  done: boolean
  counts?: Record<string, number>
  url?: string | null
  note?: string | null
}

const isDone = (send: NewsletterSend | null, provider: ProviderStatus | null) =>
  !send || send.status === 'sent' || (send.status === 'handed_off' && Boolean(provider?.done))

/** The editor's sidebar fill (see PostEditorSidebarProps). Posts only. */
export default function PostAccessBox({ kind, postId, record, values, disabled, onChange }: PostEditorSidebarProps) {
  const visibility = String(values.visibility || 'public') as Visibility
  const sendNewsletter = 'send_newsletter' in values
    ? Boolean(values.send_newsletter)
    : Boolean(Number(record?.send_newsletter ?? 0))

  const { t } = useT()
  const [send, setSend] = useState<NewsletterSend | null>(null)
  const [provider, setProvider] = useState<ProviderStatus | null>(null)
  const [maySend, setMaySend] = useState(true)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!postId) return
    let cancelled = false

    const load = () =>
      api.get<{ send: NewsletterSend | null; provider: ProviderStatus | null; may_send: boolean }>(`/api/posts/${postId}/newsletter`)
        .then(res => {
          if (cancelled) return
          setSend(res?.send ?? null)
          setProvider(res?.provider ?? null)
          setMaySend(res?.may_send !== false)
        })
        .catch(() => {})

    load()
    // While a send is in progress, watch it move. Loading the status is also
    // what nudges the queue along on a host with no cron.
    const timer = setInterval(() => { if (!isDone(send, provider)) load() }, 15_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [postId, send?.status, provider?.status])

  const sendTest = async () => {
    if (!postId) return
    setTesting(true)
    setMessage('')
    try {
      const res = await api.post<{ message: string }>(`/api/posts/${postId}/newsletter/test`, {})
      setMessage(res?.message || t('Sent.'))
    } catch (err: any) {
      setMessage(err.message || t('Could not send the test.'))
    } finally {
      setTesting(false)
    }
  }

  if (kind !== 'post') return null

  return (
    <div className="admin-card">
      <h3 className="admin-card-title">{t('Access & newsletter')}</h3>

      <div className="admin-form-group">
        <label className="admin-label" htmlFor="visibility">{t('Who can read it')}</label>
        <select
          id="visibility"
          value={visibility}
          disabled={disabled}
          onChange={e => onChange({ visibility: e.target.value as Visibility })}
          className="admin-input"
        >
          <option value="public">{t('Everyone')}</option>
          <option value="members">{t('Members only')}</option>
          <option value="paid">{t('Paid members (treated as members for now)')}</option>
        </select>
        <small style={{ color: 'var(--fg-muted)' }}>
          {visibility === 'public'
            ? t('The whole post is public.')
            : t('Title, excerpt and image stay public; the body needs a member sign-in.')}
        </small>
      </div>

      {send && send.status === 'handoff_failed' ? (
        <div className="admin-form-group">
          <p style={{ margin: 0 }}>
            <span className="admin-badge admin-badge-warning">{t('Newsletter not sent yet')}</span>
          </p>
          <small style={{ color: 'var(--fg-muted)' }}>
            {t('The newsletter service could not take it, and it will be tried again: {error}', { error: send.handoff_error || '' })}
          </small>
        </div>
      ) : send && (send.status === 'handed_off' || send.status === 'handing_off') ? (
        <div className="admin-form-group">
          <p style={{ margin: 0 }}>
            <span className={`admin-badge ${provider?.done ? 'admin-badge-success' : 'admin-badge-warning'}`}>
              {provider ? t('{name}: {status}', { name: provider.name, status: provider.status }) : t('Newsletter handed off')}
            </span>
          </p>
          <small style={{ color: 'var(--fg-muted)' }}>
            {provider?.counts && Object.entries(provider.counts).map(([key, n]) => `${t(key)} ${n}`).join(' · ')}
            {provider?.note ? <> {provider.note}</> : null}
            {provider?.url ? <> <a href={provider.url} target="_blank" rel="noreferrer">{t('Open in {name}', { name: provider.name })}</a></> : null}
            {' '}{t('A post is only ever sent once.')}
          </small>
        </div>
      ) : send ? (
        <div className="admin-form-group">
          <p style={{ margin: 0 }}>
            <span className={`admin-badge ${send.status === 'sent' ? 'admin-badge-success' : 'admin-badge-warning'}`}>
              {send.status === 'sent' ? t('Newsletter sent') : t('Newsletter sending')}
            </span>
          </p>
          <small style={{ color: 'var(--fg-muted)' }}>
            {(() => {
              const counts = { sent: send.sent_count, total: send.total_count, failed: send.failed_count, skipped: send.skipped_count }
              if (send.failed_count && send.skipped_count) return t('{sent} of {total} delivered, {failed} failed, {skipped} skipped.', counts)
              if (send.failed_count) return t('{sent} of {total} delivered, {failed} failed.', counts)
              if (send.skipped_count) return t('{sent} of {total} delivered, {skipped} skipped.', counts)
              return t('{sent} of {total} delivered.', counts)
            })()}
            {' '}{t('A post is only ever sent once.')}
          </small>
        </div>
      ) : (
        <div className="admin-form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="checkbox"
              checked={sendNewsletter}
              disabled={disabled || !maySend}
              onChange={e => onChange({ send_newsletter: e.target.checked })}
            />
            {t('Email to subscribed members when it goes live')}
          </label>
          <small style={{ color: 'var(--fg-muted)' }}>
            {maySend
              ? t('Sent once, when the post is published (or when its schedule arrives).')
              : t('An editor or admin can send a post as a newsletter.')}
          </small>
        </div>
      )}

      {postId && (
        <div className="admin-form-group">
          <button type="button" className="admin-btn admin-btn-secondary" onClick={sendTest} disabled={testing}>
            {testing ? t('Sending…') : t('Send a test to me')}
          </button>
          {message && <p style={{ color: 'var(--fg-muted)', fontSize: '0.875rem', margin: '0.5rem 0 0' }}>{message}</p>}
          <small style={{ display: 'block', color: 'var(--fg-muted)' }}>{t('Uses the last saved version.')}</small>
        </div>
      )}
    </div>
  )
}
