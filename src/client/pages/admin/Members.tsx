import React, { useState, useEffect, useRef } from 'react'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'
import { Pagination, type PageMeta } from '../../components/admin/Pagination'
import { useT, currentLocale, slots } from '../../i18n'

interface Member {
  id: number
  email: string
  name: string | null
  status: 'active' | 'unsubscribed'
  newsletter: boolean
  labels: string | null
  note: string | null
  source: 'signup' | 'admin' | 'import'
  email_verified_at: string | null
  last_seen_at: string | null
  created_at: string
}

interface Counts {
  total: number
  active: number
  unsubscribed: number
}

interface Send {
  id: number
  post_id: number
  post_title: string | null
  status: 'preparing' | 'sending' | 'sent'
  total_count: number
  sent_count: number
  failed_count: number
  skipped_count: number
  created_at: string
  completed_at: string | null
}

interface ImportResult {
  imported: number
  existing: number
  invalid: number
  errors: Array<{ row: number; error: string }>
}

const EMPTY = { email: '', name: '', labels: '', newsletter: true }

/** The settings this page owns. All live in the `members` group of the allowlist. */
const SETTING_KEYS = ['members_signup', 'members_signin_url', 'newsletter_sender_name', 'newsletter_reply_to', 'newsletter_footer'] as const
type SettingKey = (typeof SETTING_KEYS)[number]

const date = (value: string | null) => {
  if (!value) return '—'
  const parsed = new Date(/Z|[+-]\d\d:?\d\d$/.test(value) ? value : value.replace(' ', 'T') + 'Z')
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString(currentLocale())
}

/**
 * Members: the readers who signed up with a magic link, were added here, or
 * were imported — and the newsletter they receive.
 *
 * Members are not users. They have no password and no admin access; the
 * routes behind this page are admin-only (`user.manage`) because the list is
 * other people's email addresses.
 */
export default function AdminMembers() {
  const { t } = useT()
  const SOURCES: Record<Member['source'], string> = { signup: t('signup'), admin: t('admin'), import: t('import') }
  const SEND_STATUSES: Record<Send['status'], string> = { preparing: t('preparing'), sending: t('sending'), sent: t('sent') }
  const [members, setMembers] = useState<Member[]>([])
  const [counts, setCounts] = useState<Counts>({ total: 0, active: 0, unsubscribed: 0 })
  const [meta, setMeta] = useState<PageMeta | null>(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [settings, setSettings] = useState<Record<SettingKey, string>>({
    members_signup: 'open', members_signin_url: '', newsletter_sender_name: '', newsletter_reply_to: '', newsletter_footer: ''
  })
  const [settingsMessage, setSettingsMessage] = useState('')
  const [sends, setSends] = useState<Send[]>([])
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    load(page, search, status)
  }, [page, status])

  useEffect(() => {
    loadSettings()
    loadSends()
  }, [])

  const load = async (which: number, term: string, filter: string) => {
    try {
      const params = new URLSearchParams({ page: String(which) })
      if (term.trim()) params.set('search', term.trim())
      if (filter) params.set('status', filter)

      const res = await api.get<{ members: Member[]; meta: PageMeta; counts: Counts }>(`/api/members?${params}`)
      setMembers(res?.members || [])
      setMeta(res?.meta || null)
      if (res?.counts) setCounts(res.counts)
    } catch (err) {
      console.error('Failed to load members:', err)
    } finally {
      setLoading(false)
    }
  }

  const loadSettings = async () => {
    try {
      const res = await api.get<{ settings: Record<string, string> }>('/api/settings')
      const stored = res?.settings || {}
      setSettings(prev => {
        const next = { ...prev }
        for (const key of SETTING_KEYS) if (stored[key] !== undefined) next[key] = stored[key]
        return next
      })
    } catch {
      // Settings are admin-only too; nothing to show if they cannot be read.
    }
  }

  const loadSends = async () => {
    try {
      const res = await api.get<{ sends: Send[] }>('/api/newsletters')
      setSends(res?.sends || [])
    } catch {
      setSends([])
    }
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await api.post('/api/members', form)
      setForm(EMPTY)
      load(page, search, status)
    } catch (err: any) {
      setError(err.message || t('Failed to add member'))
    }
  }

  const toggleNewsletter = async (member: Member) => {
    try {
      await api.put(`/api/members/${member.id}`, { newsletter: !member.newsletter })
      load(page, search, status)
    } catch (err: any) {
      alert(err.message || t('Failed to update member'))
    }
  }

  const handleDelete = async (member: Member) => {
    if (!confirm(t('Delete {email}? They are signed out and receive no further newsletters. This cannot be undone.', { email: member.email }))) return
    try {
      await api.delete(`/api/members/${member.id}`)
      load(page, search, status)
    } catch (err: any) {
      alert(err.message || t('Failed to delete member'))
    }
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    load(1, search, status)
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setImportResult(null)
    try {
      const csv = await file.text()
      const res = await api.post<ImportResult>('/api/members/import', { csv })
      setImportResult(res)
      load(1, search, status)
      setPage(1)
    } catch (err: any) {
      alert(err.message || t('Import failed'))
    } finally {
      setImporting(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  /**
   * The export is CSV, not JSON, so it cannot go through `api` — fetched with
   * the session header and handed to the browser as a file.
   */
  const handleExport = async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/members/export', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      if (!res.ok) throw new Error(t('Export failed ({status})', { status: res.status }))
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `members-${new Date().toISOString().slice(0, 10)}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      alert(err.message || t('Export failed'))
    }
  }

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    setSettingsMessage('')
    try {
      await api.put('/api/settings', { settings })
      setSettingsMessage(t('Saved.'))
    } catch (err: any) {
      setSettingsMessage(err.message || t('Failed to save settings'))
    }
  }

  const setSetting = (key: SettingKey) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setSettings(prev => ({ ...prev, [key]: e.target.value }))

  if (loading) {
    return (
      <AdminLayout title={t('Members')}>
        <div className="admin-loading">{t('Loading...')}</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout title={t('Members')}>
      <div className="admin-grid admin-grid-3">
        <div className="admin-card">
          <h3 className="admin-card-title">{t('Members')}</h3>
          <p style={{ fontSize: '1.75rem', margin: 0 }}>{counts.total}</p>
        </div>
        <div className="admin-card">
          <h3 className="admin-card-title">{t('Subscribed')}</h3>
          <p style={{ fontSize: '1.75rem', margin: 0 }}>{counts.active}</p>
        </div>
        <div className="admin-card">
          <h3 className="admin-card-title">{t('Unsubscribed')}</h3>
          <p style={{ fontSize: '1.75rem', margin: 0 }}>{counts.unsubscribed}</p>
        </div>
      </div>

      <div className="admin-card">
        <h3 className="admin-card-title">{t('Add a member')}</h3>
        <form onSubmit={handleAdd}>
          <div className="admin-grid admin-grid-3">
            <div className="admin-form-group">
              <label className="admin-label">{t('Email')}</label>
              <input type="email" required className="admin-input" value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="admin-form-group">
              <label className="admin-label">{t('Name')}</label>
              <input type="text" className="admin-input" value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="admin-form-group">
              <label className="admin-label">{t('Labels')}</label>
              <input type="text" className="admin-input" placeholder={t('comma, separated')} value={form.labels}
                onChange={e => setForm({ ...form, labels: e.target.value })} />
            </div>
          </div>
          <div className="admin-form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input type="checkbox" checked={form.newsletter} onChange={e => setForm({ ...form, newsletter: e.target.checked })} />
              {t('Subscribed to the newsletter')}
            </label>
          </div>
          {error && <p style={{ color: 'var(--danger)', marginBottom: '0.75rem' }}>{error}</p>}
          <button type="submit" className="admin-btn admin-btn-primary">{t('Add member')}</button>
        </form>
        <p style={{ color: 'var(--fg-muted)', fontSize: '0.875rem', marginTop: '0.75rem' }}>
          {t('No email is sent. They sign in with a magic link whenever they choose, from your front end.')}
        </p>
      </div>

      <div className="admin-card">
        <div className="admin-card-header">
          <h3 className="admin-card-title">{t('All members')}</h3>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.5rem' }}>
              <input type="search" value={search} onChange={e => setSearch(e.target.value)}
                className="admin-input" placeholder={t('Search email, name, labels')} />
              <button type="submit" className="admin-btn admin-btn-secondary">{t('Search')}</button>
            </form>
            <select className="admin-select" value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}>
              <option value="">{t('Everyone')}</option>
              <option value="active">{t('Subscribed')}</option>
              <option value="unsubscribed">{t('Unsubscribed')}</option>
            </select>
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => fileInput.current?.click()} disabled={importing}>
              {importing ? t('Importing…') : t('Import CSV')}
            </button>
            <input ref={fileInput} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={handleImport} />
            <button type="button" className="admin-btn admin-btn-secondary" onClick={handleExport}>{t('Export CSV')}</button>
          </div>
        </div>

        {importResult && (
          <p style={{ color: 'var(--fg-muted)', fontSize: '0.875rem' }}>
            {importResult.errors.length > 0
              ? t('Imported {imported}; {existing} already members (left unchanged); {invalid} invalid — first problem on row {row}: {error}.', {
                imported: importResult.imported,
                existing: importResult.existing,
                invalid: importResult.invalid,
                row: importResult.errors[0].row,
                error: importResult.errors[0].error
              })
              : t('Imported {imported}; {existing} already members (left unchanged); {invalid} invalid.', {
                imported: importResult.imported,
                existing: importResult.existing,
                invalid: importResult.invalid
              })}
          </p>
        )}

        {members.length === 0 ? (
          <p style={{ color: 'var(--fg-muted)', textAlign: 'center', padding: '2rem' }}>{t('No members.')}</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t('Email')}</th>
                <th>{t('Name')}</th>
                <th>{t('Newsletter')}</th>
                <th>{t('Labels')}</th>
                <th>{t('Source')}</th>
                <th>{t('Joined')}</th>
                <th>{t('Last seen')}</th>
                <th>{t('Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {members.map(member => (
                <tr key={member.id}>
                  <td>
                    {member.email}
                    {!member.email_verified_at && (
                      <span className="admin-badge admin-badge-warning" style={{ marginLeft: '0.5rem' }} title={t('Has never followed a sign-in link')}>
                        {t('unverified')}
                      </span>
                    )}
                  </td>
                  <td>{member.name || '—'}</td>
                  <td>
                    <span className={`admin-badge ${member.newsletter ? 'admin-badge-success' : 'admin-badge-warning'}`}>
                      {member.newsletter ? t('Subscribed') : t('Unsubscribed')}
                    </span>
                  </td>
                  <td>{member.labels || '—'}</td>
                  <td>{SOURCES[member.source] ?? member.source}</td>
                  <td>{date(member.created_at)}</td>
                  <td>{date(member.last_seen_at)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button onClick={() => toggleNewsletter(member)} className="admin-btn admin-btn-secondary">
                        {member.newsletter ? t('Unsubscribe') : t('Subscribe')}
                      </button>
                      <button onClick={() => handleDelete(member)} className="admin-btn admin-btn-danger">{t('Delete')}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {meta && <Pagination meta={meta} onChange={setPage} noun={t('members')} />}

        <p style={{ color: 'var(--fg-muted)', fontSize: '0.875rem', marginTop: '0.75rem' }}>
          {slots(t('CSV import reads a header row with {email} and optionally {name}, {labels}, {note} and {subscribed} (yes/no). Existing members are skipped, never overwritten.'), {
            email: <code>{'email'}</code>,
            name: <code>{'name'}</code>,
            labels: <code>{'labels'}</code>,
            note: <code>{'note'}</code>,
            subscribed: <code>{'subscribed'}</code>
          })}
        </p>
      </div>

      <form onSubmit={saveSettings}>
        <div className="admin-grid admin-grid-2">
          <div className="admin-card">
            <h3 className="admin-card-title">{t('Membership')}</h3>
            <div className="admin-form-group">
              <label className="admin-label" htmlFor="members_signup">{t('Who can sign up')}</label>
              <select id="members_signup" className="admin-select" value={settings.members_signup || 'open'} onChange={setSetting('members_signup')}>
                <option value="open">{t('Anyone')}</option>
                <option value="invite">{t('Only members added or imported here')}</option>
                <option value="closed">{t('Nobody — sign-in links are not sent')}</option>
              </select>
            </div>
            <div className="admin-form-group">
              <label className="admin-label" htmlFor="members_signin_url">{t('Sign-in page on your front end')}</label>
              <input id="members_signin_url" type="url" className="admin-input" placeholder={'https://example.com/members/verify'}
                value={settings.members_signin_url} onChange={setSetting('members_signin_url')} />
              <small style={{ color: 'var(--fg-muted)' }}>
                {slots(t('Magic links open this page with {token}; it POSTs the token to {endpoint}. Blank uses SITE_URL + {path}.'), {
                  token: <code>?token=</code>,
                  endpoint: <code>{'/api/v1/members/verify'}</code>,
                  path: <code>{'/members/verify'}</code>
                })}
              </small>
            </div>
          </div>

          <div className="admin-card">
            <h3 className="admin-card-title">{t('Newsletter')}</h3>
            <div className="admin-form-group">
              <label className="admin-label" htmlFor="newsletter_sender_name">{t('Sender name')}</label>
              <input id="newsletter_sender_name" type="text" className="admin-input" placeholder={t('Defaults to the site name')}
                value={settings.newsletter_sender_name} onChange={setSetting('newsletter_sender_name')} />
            </div>
            <div className="admin-form-group">
              <label className="admin-label" htmlFor="newsletter_reply_to">{t('Reply-to address')}</label>
              <input id="newsletter_reply_to" type="email" className="admin-input"
                value={settings.newsletter_reply_to} onChange={setSetting('newsletter_reply_to')} />
            </div>
            <div className="admin-form-group">
              <label className="admin-label" htmlFor="newsletter_footer">{t('Footer text')}</label>
              <textarea id="newsletter_footer" className="admin-input" rows={3}
                value={settings.newsletter_footer} onChange={setSetting('newsletter_footer')} />
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1.5rem' }}>
          <button type="submit" className="admin-btn admin-btn-primary">{t('Save settings')}</button>
          {settingsMessage && <span style={{ color: 'var(--fg-muted)' }}>{settingsMessage}</span>}
        </div>
      </form>

      <div className="admin-card">
        <h3 className="admin-card-title">{t('Recent newsletters')}</h3>
        {sends.length === 0 ? (
          <p style={{ color: 'var(--fg-muted)' }}>
            {t('Nothing sent yet. Tick “Email to subscribed members” in a post’s editor; it is sent once, when the post goes live.')}
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t('Post')}</th>
                <th>{t('Status')}</th>
                <th>{t('Delivered')}</th>
                <th>{t('Failed')}</th>
                <th>{t('Skipped')}</th>
                <th>{t('Started')}</th>
              </tr>
            </thead>
            <tbody>
              {sends.map(send => (
                <tr key={send.id}>
                  <td>{send.post_title || t('Post {id}', { id: send.post_id })}</td>
                  <td>
                    <span className={`admin-badge ${send.status === 'sent' ? 'admin-badge-success' : 'admin-badge-warning'}`}>{SEND_STATUSES[send.status] ?? send.status}</span>
                  </td>
                  <td>{send.sent_count} / {send.total_count}</td>
                  <td>{send.failed_count}</td>
                  <td>{send.skipped_count}</td>
                  <td>{date(send.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AdminLayout>
  )
}
