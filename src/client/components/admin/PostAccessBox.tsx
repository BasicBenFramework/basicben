import { useEffect, useState } from 'react'
import { api } from '../../../helpers/api'

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
  status: 'preparing' | 'sending' | 'sent'
  total_count: number
  sent_count: number
  failed_count: number
  skipped_count: number
  completed_at: string | null
}

interface PostAccessBoxProps {
  postId: number | null
  visibility: Visibility
  sendNewsletter: boolean
  disabled?: boolean
  onChange: (changes: { visibility?: Visibility; send_newsletter?: boolean }) => void
}

export default function PostAccessBox({ postId, visibility, sendNewsletter, disabled, onChange }: PostAccessBoxProps) {
  const [send, setSend] = useState<NewsletterSend | null>(null)
  const [maySend, setMaySend] = useState(true)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!postId) return
    let cancelled = false

    const load = () =>
      api.get<{ send: NewsletterSend | null; may_send: boolean }>(`/api/posts/${postId}/newsletter`)
        .then(res => {
          if (cancelled) return
          setSend(res?.send ?? null)
          setMaySend(res?.may_send !== false)
        })
        .catch(() => {})

    load()
    // While a send is in progress, watch it move. Loading the status is also
    // what nudges the queue along on a host with no cron.
    const timer = setInterval(() => { if (send && send.status !== 'sent') load() }, 15_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [postId, send?.status])

  const sendTest = async () => {
    if (!postId) return
    setTesting(true)
    setMessage('')
    try {
      const res = await api.post<{ message: string }>(`/api/posts/${postId}/newsletter/test`, {})
      setMessage(res?.message || 'Sent.')
    } catch (err: any) {
      setMessage(err.message || 'Could not send the test.')
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="admin-card">
      <h3 className="admin-card-title">Access &amp; newsletter</h3>

      <div className="admin-form-group">
        <label className="admin-label" htmlFor="visibility">Who can read it</label>
        <select
          id="visibility"
          value={visibility}
          disabled={disabled}
          onChange={e => onChange({ visibility: e.target.value as Visibility })}
          className="admin-input"
        >
          <option value="public">Everyone</option>
          <option value="members">Members only</option>
          <option value="paid">Paid members (treated as members for now)</option>
        </select>
        <small style={{ color: 'var(--fg-muted)' }}>
          {visibility === 'public'
            ? 'The whole post is public.'
            : 'Title, excerpt and image stay public; the body needs a member sign-in.'}
        </small>
      </div>

      {send ? (
        <div className="admin-form-group">
          <p style={{ margin: 0 }}>
            <span className={`admin-badge ${send.status === 'sent' ? 'admin-badge-success' : 'admin-badge-warning'}`}>
              {send.status === 'sent' ? 'Newsletter sent' : 'Newsletter sending'}
            </span>
          </p>
          <small style={{ color: 'var(--fg-muted)' }}>
            {send.sent_count} of {send.total_count} delivered
            {send.failed_count ? `, ${send.failed_count} failed` : ''}
            {send.skipped_count ? `, ${send.skipped_count} skipped` : ''}.
            {' '}A post is only ever sent once.
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
            Email to subscribed members when it goes live
          </label>
          <small style={{ color: 'var(--fg-muted)' }}>
            {maySend
              ? 'Sent once, when the post is published (or when its schedule arrives).'
              : 'An editor or admin can send a post as a newsletter.'}
          </small>
        </div>
      )}

      {postId && (
        <div className="admin-form-group">
          <button type="button" className="admin-btn admin-btn-secondary" onClick={sendTest} disabled={testing}>
            {testing ? 'Sending…' : 'Send a test to me'}
          </button>
          {message && <p style={{ color: 'var(--fg-muted)', fontSize: '0.875rem', margin: '0.5rem 0 0' }}>{message}</p>}
          <small style={{ display: 'block', color: 'var(--fg-muted)' }}>Uses the last saved version.</small>
        </div>
      )}
    </div>
  )
}
