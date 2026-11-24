import React, { useState, useEffect } from 'react'
import { api } from '../../../helpers/api.ts'
import AdminLayout from '../../layouts/AdminLayout.tsx'
import { Pagination, type PageMeta } from '../../components/admin/Pagination.tsx'
import { useT, t, slots } from '../../i18n/index.ts'

type Status = 'pending' | 'approved' | 'spam' | 'trash'
type Tab = 'all' | Status

interface Comment {
  id: number
  post_id: number
  parent_id?: number | null
  content: string
  author_name?: string
  author_email?: string
  user_name?: string
  user_email?: string
  post_title?: string
  parent_author_name?: string
  parent_content?: string
  status: Status
  held_reason?: string | null
  author_ip?: string | null
  created_at: string
  replies?: Comment[]
}

type Counts = Record<Tab, number>

interface ListResponse {
  comments: Comment[]
  counts: Counts
  meta: PageMeta
}

interface CommentSettings {
  comment_blocklist: string
  comment_max_links: number
  comment_notify: 'author' | 'moderators' | 'both' | 'none'
}

const TABS: { key: Tab }[] = [
  { key: 'all' },
  { key: 'pending' },
  { key: 'approved' },
  { key: 'spam' },
  { key: 'trash' }
]

/** A tab's name. Called while rendering, so it follows the admin's language. */
function tabLabel(tab: Tab): string {
  switch (tab) {
    case 'all': return t('All')
    case 'pending': return t('Pending')
    case 'approved': return t('Approved')
    case 'spam': return t('Spam')
    case 'trash': return t('Trash')
  }
}

/** A comment's status, as its badge shows it. */
function statusLabel(status: Status): string {
  switch (status) {
    case 'pending': return t('pending')
    case 'approved': return t('approved')
    case 'spam': return t('spam')
    case 'trash': return t('trash')
    default: return status
  }
}

const BADGES: Record<Status, string> = {
  pending: 'admin-badge-warning',
  approved: 'admin-badge-success',
  spam: 'admin-badge-danger',
  trash: 'admin-badge-info'
}

/** The tab a link asked for — the moderation email links to `?status=pending`. */
function initialTab(): Tab {
  const asked = new URLSearchParams(window.location.search).get('status')
  return TABS.some(tab => tab.key === asked) ? asked as Tab : 'all'
}

const excerpt = (text = '', length = 80) => (text.length > length ? `${text.slice(0, length)}…` : text)

/**
 * The comment moderation screen.
 *
 * A tab per status with the count behind it, bulk actions over a checked
 * page, and each comment's thread a click away — a reply makes no sense to
 * judge without what it answers. The settings that decide what lands in each
 * tab (the blocklist, the link limit, who is emailed) live here too, beside
 * the results they produce.
 */
export default function AdminComments() {
  const { t, tn, locale } = useT()
  const [tab, setTab] = useState<Tab>(initialTab)
  const [page, setPage] = useState(1)
  const [comments, setComments] = useState<Comment[]>([])
  const [counts, setCounts] = useState<Counts | null>(null)
  const [meta, setMeta] = useState<PageMeta | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [threadFor, setThreadFor] = useState<Comment | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.get<ListResponse>(`/api/comments?status=${tab}&page=${page}`)
      setComments(res?.comments || [])
      setCounts(res?.counts || null)
      setMeta(res?.meta || null)
      setSelected(new Set())
    } catch (error) {
      console.error('Failed to load comments:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [tab, page])

  const switchTab = (next: Tab) => {
    setTab(next)
    setPage(1)
    setThreadFor(null)
  }

  const setStatus = async (id: number, status: Status) => {
    try {
      await api.put(`/api/comments/${id}/status`, { status })
      await load()
    } catch (error) {
      alert((error as Error).message || t('Failed to update comment'))
    }
  }

  const deleteForever = async (id: number) => {
    if (!confirm(t('Delete this comment permanently? Its replies stay, moved up a level. This cannot be undone.'))) return
    try {
      await api.delete(`/api/comments/${id}?force=true`)
      await load()
    } catch (error) {
      alert((error as Error).message || t('Failed to delete comment'))
    }
  }

  const bulk = async (action: string) => {
    if (!selected.size) return
    if (action === 'delete' && !confirm(tn('Delete {count} comment permanently? This cannot be undone.', 'Delete {count} comments permanently? This cannot be undone.', selected.size))) return
    try {
      await api.post('/api/comments/bulk', { ids: [...selected], action })
      await load()
    } catch (error) {
      alert((error as Error).message || t('Bulk action failed'))
    }
  }

  const empty = async (status: 'spam' | 'trash') => {
    const n = counts?.[status] ?? 0
    const question = status === 'spam'
      ? tn('Permanently delete the {count} comment in spam? This cannot be undone.', 'Permanently delete all {count} comments in spam? This cannot be undone.', n)
      : tn('Permanently delete the {count} comment in the trash? This cannot be undone.', 'Permanently delete all {count} comments in the trash? This cannot be undone.', n)
    if (!confirm(question)) return
    try {
      await api.post('/api/comments/empty', { status })
      await load()
    } catch (error) {
      alert((error as Error).message || (status === 'spam' ? t('Failed to empty spam') : t('Failed to empty the trash')))
    }
  }

  const toggle = (id: number) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const allChecked = comments.length > 0 && comments.every(c => selected.has(c.id))

  return (
    <AdminLayout title={t('Comments')}>
      <div className="admin-card">
        <div className="admin-card-header" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {TABS.map(({ key }) => (
              <button
                key={key}
                onClick={() => switchTab(key)}
                className={`admin-btn ${tab === key ? 'admin-btn-primary' : 'admin-btn-secondary'}`}
              >
                {tabLabel(key)}{counts ? ` (${counts[key]})` : ''}
              </button>
            ))}
            <button onClick={() => setShowSettings(!showSettings)} className="admin-btn admin-btn-secondary">
              {showSettings ? t('Hide settings') : t('Spam settings')}
            </button>
          </div>
        </div>

        {showSettings && <SettingsPanel />}

        {/* Bulk actions: what makes sense depends on where the comments are. */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)' }}>
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={allChecked}
              onChange={() => setSelected(allChecked ? new Set() : new Set(comments.map(c => c.id)))}
              aria-label={t('Select all on this page')}
            />
            <span style={{ color: 'var(--fg-muted)', fontSize: '0.875rem' }}>{tn('{count} selected', '{count} selected', selected.size)}</span>
          </label>
          {tab !== 'approved' && tab !== 'trash' && <BulkButton label={t('Approve')} onClick={() => bulk('approve')} disabled={!selected.size} />}
          {(tab === 'all' || tab === 'approved') && <BulkButton label={t('Unapprove')} onClick={() => bulk('pending')} disabled={!selected.size} />}
          {tab !== 'spam' && <BulkButton label={t('Mark spam')} onClick={() => bulk('spam')} disabled={!selected.size} />}
          {tab === 'spam' && <BulkButton label={t('Not spam')} onClick={() => bulk('pending')} disabled={!selected.size} />}
          {tab === 'trash' && <BulkButton label={t('Restore')} onClick={() => bulk('pending')} disabled={!selected.size} />}
          {tab !== 'trash' && tab !== 'spam' && <BulkButton label={t('Trash')} onClick={() => bulk('trash')} disabled={!selected.size} />}
          {(tab === 'trash' || tab === 'spam') && <BulkButton label={t('Delete permanently')} danger onClick={() => bulk('delete')} disabled={!selected.size} />}
          {(tab === 'spam' || tab === 'trash') && (counts?.[tab] ?? 0) > 0 && (
            <button onClick={() => empty(tab)} className="admin-btn admin-btn-danger" style={{ marginLeft: 'auto' }}>
              {tab === 'spam' ? t('Empty spam') : t('Empty trash')}
            </button>
          )}
        </div>

        {loading ? (
          <div className="admin-loading">{t('Loading...')}</div>
        ) : comments.length === 0 ? (
          <p style={{ color: 'var(--fg-muted)', textAlign: 'center', padding: '2rem' }}>
            {{
              all: t('No comments.'),
              pending: t('No pending comments.'),
              approved: t('No approved comments.'),
              spam: t('No spam comments.'),
              trash: t('No trash comments.')
            }[tab]}
          </p>
        ) : (
          <div>
            {comments.map(comment => (
              <div
                key={comment.id}
                style={{
                  padding: '1rem',
                  borderBottom: '1px solid var(--border)',
                  backgroundColor: comment.status === 'pending' ? 'var(--tint-warning)' : 'var(--surface)'
                }}
              >
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <input
                    type="checkbox"
                    checked={selected.has(comment.id)}
                    onChange={() => toggle(comment.id)}
                    aria-label={t('Select comment')}
                    style={{ marginTop: '0.25rem' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                      <div>
                        <strong>{comment.user_name || comment.author_name || t('Anonymous')}</strong>
                        {comment.post_title && (
                          <span style={{ color: 'var(--fg-muted)' }}> {t('on {title}', { title: comment.post_title })}</span>
                        )}
                      </div>
                      <span style={{ color: 'var(--fg-muted)', fontSize: '0.875rem' }}>
                        {new Date(comment.created_at).toLocaleString(locale)}
                      </span>
                    </div>

                    {/* Who it came from, for judging it — moderators only. */}
                    <div style={{ color: 'var(--fg-muted)', fontSize: '0.8125rem', wordBreak: 'break-all' }}>
                      {comment.user_email || comment.author_email}
                      {comment.author_ip && <> &middot; {comment.author_ip}</>}
                    </div>

                    {comment.parent_id && (
                      <div style={{ color: 'var(--fg-muted)', fontSize: '0.8125rem', marginTop: '0.25rem' }}>
                        &#8627; {slots(t('In reply to {name}'), { name: <strong>{comment.parent_author_name || t('a comment')}</strong> })}
                        {comment.parent_content && <>: &ldquo;{excerpt(comment.parent_content)}&rdquo;</>}
                      </div>
                    )}

                    <p style={{ margin: '0.5rem 0', color: 'var(--fg)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{comment.content}</p>

                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className={`admin-badge ${BADGES[comment.status]}`}>{statusLabel(comment.status)}</span>
                      {comment.held_reason && (
                        <span style={{ color: 'var(--fg-muted)', fontSize: '0.8125rem' }} title={t('Why a check held this comment')}>
                          {comment.held_reason}
                        </span>
                      )}
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => setThreadFor(threadFor?.id === comment.id ? null : comment)}
                          className="admin-btn admin-btn-secondary"
                        >
                          {threadFor?.id === comment.id ? t('Hide thread') : t('Thread')}
                        </button>
                        <RowActions comment={comment} setStatus={setStatus} deleteForever={deleteForever} />
                      </div>
                    </div>

                    {threadFor?.id === comment.id && (
                      <ThreadView postId={comment.post_id} highlight={comment.id} onChange={load} />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {meta && <Pagination meta={meta} onChange={setPage} noun={t('comments')} />}
      </div>
    </AdminLayout>
  )
}

function BulkButton({ label, onClick, disabled, danger }: { label: string; onClick: () => void; disabled: boolean; danger?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className={`admin-btn ${danger ? 'admin-btn-danger' : 'admin-btn-secondary'}`}>
      {label}
    </button>
  )
}

function RowActions({ comment, setStatus, deleteForever }: {
  comment: Comment
  setStatus: (id: number, status: Status) => void
  deleteForever: (id: number) => void
}) {
  const { t } = useT()
  const button = (label: string, onClick: () => void, kind = 'admin-btn-secondary') => (
    <button key={label} onClick={onClick} className={`admin-btn ${kind}`}>{label}</button>
  )

  switch (comment.status) {
    case 'pending':
      return (<>
        {button(t('Approve'), () => setStatus(comment.id, 'approved'), 'admin-btn-primary')}
        {button(t('Spam'), () => setStatus(comment.id, 'spam'))}
        {button(t('Trash'), () => setStatus(comment.id, 'trash'), 'admin-btn-danger')}
      </>)
    case 'approved':
      return (<>
        {button(t('Unapprove'), () => setStatus(comment.id, 'pending'))}
        {button(t('Spam'), () => setStatus(comment.id, 'spam'))}
        {button(t('Trash'), () => setStatus(comment.id, 'trash'), 'admin-btn-danger')}
      </>)
    case 'spam':
      // Back to the queue rather than straight to approved: "not spam" is
      // not the same judgement as "worth publishing".
      return (<>
        {button(t('Not spam'), () => setStatus(comment.id, 'pending'))}
        {button(t('Delete permanently'), () => deleteForever(comment.id), 'admin-btn-danger')}
      </>)
    case 'trash':
      return (<>
        {button(t('Restore'), () => setStatus(comment.id, 'pending'))}
        {button(t('Delete permanently'), () => deleteForever(comment.id), 'admin-btn-danger')}
      </>)
  }
}

/**
 * A post's whole thread, every status, nested as readers would see it.
 *
 * Moderators can reply in place; the reply posts as them, and is approved
 * like any moderator's comment. Replies hang only off approved comments —
 * the server refuses the rest, since readers could not see what they answer.
 */
function ThreadView({ postId, highlight, onChange }: { postId: number; highlight: number; onChange: () => void }) {
  const [thread, setThread] = useState<Comment[] | null>(null)
  const [replyTo, setReplyTo] = useState<number | null>(null)
  const [text, setText] = useState('')
  const { t, locale } = useT()

  const load = () => (api.get<{ comments: Comment[] }>(`/api/posts/${postId}/comments?all=true`)
    .then(res => setThread(res?.comments || []))
    .catch(() => setThread([])))

  useEffect(() => { load() }, [postId])

  const reply = async (parentId: number) => {
    try {
      await api.post(`/api/posts/${postId}/comments`, { content: text, parent_id: parentId })
      setText('')
      setReplyTo(null)
      await load()
      onChange()
    } catch (error) {
      alert((error as Error).message || t('Failed to post reply'))
    }
  }

  const render = (nodes: Comment[]) => (
    <ul style={{ listStyle: 'none', margin: 0, paddingLeft: '1rem', borderLeft: '2px solid var(--border)' }}>
      {nodes.map(node => (
        <li key={node.id} style={{ margin: '0.5rem 0' }}>
          <div style={{
            padding: '0.5rem',
            borderRadius: 6,
            outline: node.id === highlight ? '2px solid var(--accent, var(--border))' : undefined
          }}>
            <div style={{ fontSize: '0.8125rem' }}>
              <strong>{node.user_name || node.author_name || t('Anonymous')}</strong>{' '}
              <span className={`admin-badge ${BADGES[node.status]}`}>{statusLabel(node.status)}</span>{' '}
              <span style={{ color: 'var(--fg-muted)' }}>{new Date(node.created_at).toLocaleString(locale)}</span>
            </div>
            <p style={{ margin: '0.25rem 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{node.content}</p>
            {node.status === 'approved' && (
              <button className="admin-btn admin-btn-secondary" onClick={() => setReplyTo(replyTo === node.id ? null : node.id)}>
                {replyTo === node.id ? t('Cancel') : t('Reply')}
              </button>
            )}
            {replyTo === node.id && (
              <div style={{ marginTop: '0.5rem' }}>
                <textarea className="admin-textarea" rows={3} value={text} onChange={e => setText(e.target.value)} aria-label={t('Reply')} />
                <button className="admin-btn admin-btn-primary" style={{ marginTop: '0.5rem' }} onClick={() => reply(node.id)} disabled={text.trim().length < 3}>
                  {t('Post reply')}
                </button>
              </div>
            )}
          </div>
          {node.replies && node.replies.length > 0 && render(node.replies)}
        </li>
      ))}
    </ul>
  )

  return (
    <div style={{ marginTop: '0.75rem' }}>
      {thread === null ? <div className="admin-loading">{t('Loading thread...')}</div> : render(thread)}
    </div>
  )
}

/**
 * What decides which tab a new comment lands in.
 *
 * Kept on this page rather than the general settings: these are tuned by
 * looking at what got caught, and the spam tab is right here.
 */
function SettingsPanel() {
  const [settings, setSettings] = useState<CommentSettings | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [saved, setSaved] = useState(false)
  const { t } = useT()

  useEffect(() => {
    api.get<{ settings: CommentSettings; can_manage: boolean }>('/api/comments/settings')
      .then(res => {
        setSettings(res.settings)
        setCanManage(res.can_manage)
      })
      .catch(() => setSettings(null))
  }, [])

  if (!settings) return <div className="admin-loading">{t('Loading settings...')}</div>

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const res = await api.put<{ settings: CommentSettings }>('/api/comments/settings', settings)
      setSettings(res.settings)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (error) {
      alert((error as Error).message || t('Failed to save settings'))
    }
  }

  return (
    <form onSubmit={save} style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>
      <div className="admin-form-group">
        <label className="admin-label" htmlFor="comment-blocklist">{t('Blocklist')}</label>
        <textarea
          id="comment-blocklist"
          className="admin-textarea"
          rows={6}
          value={settings.comment_blocklist}
          disabled={!canManage}
          onChange={e => setSettings({ ...settings, comment_blocklist: e.target.value })}
          placeholder={`${t('One per line:')}\n${t('cheap pills')}\nspammer@example.com\n@spam-domain.example\n203.0.113.7\n198.51.100.0/24`}
        />
        <p style={{ color: 'var(--fg-muted)', fontSize: '0.8125rem' }}>
          {slots(t('Words or phrases, email addresses, {domains}, and IP addresses or ranges. A comment that matches goes straight to spam. IPv6 entries cover their whole /64. Lines starting with # are ignored.'), {
            domains: <code>{t('@domains')}</code>
          })}
        </p>
      </div>

      <div className="admin-form-group">
        <label className="admin-label" htmlFor="comment-max-links">{t('Hold comments with more than this many links')}</label>
        <input
          id="comment-max-links"
          className="admin-input"
          type="number"
          min={0}
          max={100}
          value={settings.comment_max_links}
          disabled={!canManage}
          onChange={e => setSettings({ ...settings, comment_max_links: Number(e.target.value) })}
        />
      </div>

      <div className="admin-form-group">
        <label className="admin-label" htmlFor="comment-notify">{t('Email about comments awaiting moderation')}</label>
        <select
          id="comment-notify"
          className="admin-select"
          value={settings.comment_notify}
          disabled={!canManage}
          onChange={e => setSettings({ ...settings, comment_notify: e.target.value as CommentSettings['comment_notify'] })}
        >
          <option value="author">{t('The post\'s author')}</option>
          <option value="moderators">{t('Everyone who can moderate')}</option>
          <option value="both">{t('The author and everyone who can moderate')}</option>
          <option value="none">{t('Nobody')}</option>
        </select>
      </div>

      {canManage ? (
        <button type="submit" className="admin-btn admin-btn-primary">{saved ? t('Saved') : t('Save settings')}</button>
      ) : (
        <p style={{ color: 'var(--fg-muted)', fontSize: '0.8125rem' }}>{t('Only administrators can change these.')}</p>
      )}
    </form>
  )
}
