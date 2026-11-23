import React, { useState, useEffect } from 'react'
import { useAuth } from '@basicbenframework/core/client'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'
import { Pagination, type PageMeta } from '../../components/admin/Pagination'
import { useT } from '../../i18n'

interface UserRow {
  id: number
  name: string
  email: string
  role: string
  slug: string | null
  email_verified: boolean
  disabled_at: string | null
  created_at: string
  post_count: number
}

interface Invitation {
  id: number
  email: string
  name: string | null
  role: string
  invited_by: string | null
  expires_at: string
  created_at: string
}

type Notice = { tone: 'ok' | 'error'; text: string } | null

const FALLBACK_ROLES = ['admin', 'editor', 'author', 'contributor', 'subscriber']

/**
 * Who can sign in, and what they may do.
 *
 * Every control here is also enforced on the server — the last-admin and
 * not-yourself rules especially, since the client cannot see a concurrent
 * change by another admin. The UI disables the obvious cases so they are not
 * offered, and shows the server's refusal for the rest.
 *
 * Deleting someone who has written posts asks where the posts should go
 * first, because the server will not orphan them.
 */
export default function AdminUsers() {
  const { user: me } = useAuth() as { user: { id: number } | null }
  const { t, tn, locale } = useT()

  /** What each role can do, in a phrase — the select alone says nothing. */
  const ROLE_HINTS: Record<string, string> = {
    admin: t('Everything, including users and settings'),
    editor: t('Publish and manage everyone’s content'),
    author: t('Write and publish their own posts'),
    contributor: t('Write drafts for review'),
    subscriber: t('Comment and keep a profile')
  }

  // The built-in roles by name; a role the server adds later shows as it is.
  const ROLE_LABELS: Record<string, string> = {
    admin: t('Admin'),
    editor: t('Editor'),
    author: t('Author'),
    contributor: t('Contributor'),
    subscriber: t('Subscriber')
  }
  const roleLabel = (role: string) => ROLE_LABELS[role] ?? capitalise(role)

  // The role as it reads after "Make Jane …" / "Jane is now …".
  const ROLE_ARTICLED: Record<string, string> = {
    admin: t('an admin'),
    editor: t('an editor'),
    author: t('an author'),
    contributor: t('a contributor'),
    subscriber: t('a subscriber')
  }
  const roleArticled = (role: string) => ROLE_ARTICLED[role] ?? articled(role)

  const [users, setUsers] = useState<UserRow[]>([])
  const [roles, setRoles] = useState<string[]>(FALLBACK_ROLES)
  const [meta, setMeta] = useState<PageMeta | null>(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice>(null)

  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [invite, setInvite] = useState({ email: '', name: '', role: 'author' })
  const [inviting, setInviting] = useState(false)

  // The user being deleted, and — when they have posts — who receives them.
  const [deleting, setDeleting] = useState<UserRow | null>(null)
  const [candidates, setCandidates] = useState<UserRow[]>([])
  const [reassignTo, setReassignTo] = useState('')

  useEffect(() => {
    loadUsers()
  }, [page, query, roleFilter])

  useEffect(() => {
    loadInvitations()
  }, [])

  const loadUsers = async () => {
    try {
      const params = new URLSearchParams({ page: String(page) })
      if (query) params.set('search', query)
      if (roleFilter) params.set('role', roleFilter)

      const res = await api.get<{ users: UserRow[]; roles: string[]; meta: PageMeta }>(`/api/users?${params}`)
      setUsers(res?.users || [])
      if (res?.roles?.length) setRoles(res.roles)
      setMeta(res?.meta ?? null)
    } catch (error) {
      setNotice({ tone: 'error', text: (error as Error).message || t('Could not load users.') })
    } finally {
      setLoading(false)
    }
  }

  const loadInvitations = async () => {
    try {
      const res = await api.get<{ invitations: Invitation[] }>('/api/invitations')
      setInvitations(res?.invitations || [])
    } catch {
      // The users table is the important half; a failed side list is not
      // worth replacing the page's notice for.
    }
  }

  /** Run a change, show the server's verdict, and reload the window. */
  const act = async (work: { (): Promise<unknown> }, success: string) => {
    setNotice(null)
    try {
      await work()
      setNotice({ tone: 'ok', text: success })
    } catch (error) {
      setNotice({ tone: 'error', text: (error as Error).message || t('That did not work.') })
    }
    // Reloaded on failure too: a refusal often means someone else changed the
    // row, and what is on screen is now out of date.
    await loadUsers()
  }

  const changeRole = (target: UserRow, role: string) => {
    if (role === target.role) return
    if (!confirm(t('Make {name} {role}? They will be signed out and sign in again with the new role.', { name: target.name, role: roleArticled(role) }))) return

    act(() => api.put(`/api/users/${target.id}`, { role }), t('{name} is now {role}.', { name: target.name, role: roleArticled(role) }))
  }

  const toggleDisabled = (target: UserRow) => {
    if (target.disabled_at) {
      act(() => api.post(`/api/users/${target.id}/enable`), t('{name} can sign in again.', { name: target.name }))
      return
    }

    if (!confirm(t('Disable {name}? They are signed out everywhere and cannot sign in until enabled. Their posts stay up.', { name: target.name }))) return

    act(() => api.post(`/api/users/${target.id}/disable`), t('{name} has been disabled.', { name: target.name }))
  }

  const startDelete = async (target: UserRow) => {
    setNotice(null)

    if (target.post_count === 0) {
      if (!confirm(t('Delete {name}? This cannot be undone.', { name: target.name }))) return
      act(() => api.delete(`/api/users/${target.id}`), t('{name} was deleted.', { name: target.name }))
      return
    }

    // Everyone, not just this page: the person receiving the posts is rarely
    // on the same page of the table as the person leaving.
    setDeleting(target)
    setReassignTo('')
    try {
      const res = await api.get<{ users: UserRow[] }>('/api/users?per_page=100')
      setCandidates((res?.users || []).filter(u => u.id !== target.id))
    } catch {
      setCandidates(users.filter(u => u.id !== target.id))
    }
  }

  const confirmDelete = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!deleting || !reassignTo) return

    const target = deleting
    const receiver = candidates.find(u => String(u.id) === reassignTo)
    setDeleting(null)

    await act(
      () => api.delete(`/api/users/${target.id}?reassign=${encodeURIComponent(reassignTo)}`),
      t('{name} was deleted. Their posts now belong to {receiver}.', { name: target.name, receiver: receiver?.name ?? t('the user you chose') })
    )
  }

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault()
    setPage(1)
    setQuery(search.trim())
  }

  const handleInvite = async (event: React.FormEvent) => {
    event.preventDefault()
    setInviting(true)
    setNotice(null)

    try {
      const res = await api.post<{ message: string }>('/api/users/invite', {
        email: invite.email,
        name: invite.name || undefined,
        role: invite.role
      })
      setNotice({ tone: 'ok', text: res.message })
      setInvite({ email: '', name: '', role: invite.role })
      await loadInvitations()
    } catch (error) {
      setNotice({ tone: 'error', text: (error as Error).message || t('Could not send the invitation.') })
    } finally {
      setInviting(false)
    }
  }

  const revokeInvitation = async (invitation: Invitation) => {
    if (!confirm(t('Revoke the invitation to {email}? The link they were sent stops working.', { email: invitation.email }))) return

    try {
      await api.delete(`/api/invitations/${invitation.id}`)
      setNotice({ tone: 'ok', text: t('Invitation to {email} revoked.', { email: invitation.email }) })
    } catch (error) {
      setNotice({ tone: 'error', text: (error as Error).message || t('Could not revoke the invitation.') })
    }
    await loadInvitations()
  }

  if (loading) {
    return (
      <AdminLayout title={t('Users')}>
        <div className="admin-loading">{t('Loading…')}</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout title={t('Users')}>
      <style>{userStyles}</style>

      {notice && (
        <div className={`users-notice users-notice-${notice.tone}`} role="status">{notice.text}</div>
      )}

      {deleting && (
        <form className="users-reassign" onSubmit={confirmDelete}>
          <p className="users-reassign-title">{t('Delete {name}?', { name: deleting.name })}</p>
          <p className="users-hint">
            {tn('They have written {count} post.', 'They have written {count} posts.', deleting.post_count)}
            {' '}{t('Choose who they should belong to — nothing is deleted with the account. This cannot be undone.')}
          </p>
          <div className="users-row">
            <select
              className="admin-select"
              value={reassignTo}
              onChange={e => setReassignTo(e.target.value)}
              required
              aria-label={t('Reassign posts to')}
            >
              <option value="">{t('Reassign posts to…')}</option>
              {candidates.map(candidate => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name} ({candidate.email})
                </option>
              ))}
            </select>
            <button type="submit" className="admin-btn admin-btn-danger" disabled={!reassignTo}>
              {t('Reassign and delete')}
            </button>
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setDeleting(null)}>
              {t('Cancel')}
            </button>
          </div>
        </form>
      )}

      <div className="admin-card">
        <div className="admin-card-header">
          <h2 className="admin-card-title">{t('Users')}</h2>
          {meta && <span className="users-count">{meta.total}</span>}
        </div>

        <form className="users-row users-filters" onSubmit={handleSearch}>
          <input
            className="admin-input"
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('Search by name or email')}
            aria-label={t('Search users')}
          />
          <select
            className="admin-select"
            value={roleFilter}
            onChange={e => { setPage(1); setRoleFilter(e.target.value) }}
            aria-label={t('Filter by role')}
          >
            <option value="">{t('All roles')}</option>
            {roles.map(role => <option key={role} value={role}>{roleLabel(role)}</option>)}
          </select>
          <button type="submit" className="admin-btn admin-btn-secondary">{t('Search')}</button>
        </form>

        {users.length === 0 ? (
          <div className="users-empty">
            <p>{query || roleFilter ? t('Nobody matches that search.') : t('No users yet.')}</p>
          </div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t('Name')}</th>
                <th>{t('Role')}</th>
                <th>{t('Posts')}</th>
                <th>{t('Status')}</th>
                <th>{t('Joined')}</th>
                <th>{t('Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {users.map(row => {
                // Your own role, status and account are off limits here — the
                // server refuses them, so offering them would only invite an
                // error. Another admin can make those changes for you.
                const isMe = me?.id === row.id

                return (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.name}</strong>{isMe && <span className="users-muted"> {t('(you)')}</span>}
                      <div className="users-muted">{row.email}</div>
                    </td>
                    <td>
                      <select
                        className="admin-select"
                        value={row.role}
                        disabled={isMe}
                        onChange={e => changeRole(row, e.target.value)}
                        aria-label={t('Role for {name}', { name: row.name })}
                        title={isMe ? t('You cannot change your own role') : ROLE_HINTS[row.role]}
                      >
                        {roles.map(role => <option key={role} value={role}>{roleLabel(role)}</option>)}
                      </select>
                    </td>
                    <td>{row.post_count}</td>
                    <td>
                      {row.disabled_at ? (
                        <span className="admin-badge admin-badge-danger">{t('Disabled')}</span>
                      ) : row.email_verified ? (
                        <span className="admin-badge admin-badge-success">{t('Active')}</span>
                      ) : (
                        <span className="admin-badge admin-badge-warning">{t('Unverified')}</span>
                      )}
                    </td>
                    <td className="users-muted">{new Date(row.created_at).toLocaleDateString(locale)}</td>
                    <td>
                      <div className="users-row">
                        <button
                          onClick={() => toggleDisabled(row)}
                          className="admin-btn admin-btn-secondary"
                          disabled={isMe}
                        >
                          {row.disabled_at ? t('Enable') : t('Disable')}
                        </button>
                        <button
                          onClick={() => startDelete(row)}
                          className="admin-btn admin-btn-danger"
                          disabled={isMe}
                        >
                          {t('Delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {meta && <Pagination meta={meta} onChange={setPage} noun={t('users')} />}
      </div>

      <div className="admin-card">
        <div className="admin-card-header">
          <h2 className="admin-card-title">{t('Invite someone')}</h2>
        </div>

        <form onSubmit={handleInvite} className="users-form">
          <label className="users-field">
            <span className="users-label">{t('Email')}</span>
            <input
              className="admin-input"
              type="email"
              value={invite.email}
              onChange={e => setInvite({ ...invite, email: e.target.value })}
              placeholder={'jane@example.com'}
              required
            />
          </label>

          <label className="users-field">
            <span className="users-label">{t('Name (optional)')}</span>
            <input
              className="admin-input"
              value={invite.name}
              onChange={e => setInvite({ ...invite, name: e.target.value })}
              placeholder={t('Filled in on their sign-up form; they can change it')}
            />
          </label>

          <label className="users-field">
            <span className="users-label">{t('Role')}</span>
            <select
              className="admin-select"
              value={invite.role}
              onChange={e => setInvite({ ...invite, role: e.target.value })}
            >
              {roles.map(role => <option key={role} value={role}>{roleLabel(role)}</option>)}
            </select>
            <span className="users-hint">{ROLE_HINTS[invite.role] ?? ''}</span>
          </label>

          <div>
            <button type="submit" className="admin-btn admin-btn-primary" disabled={inviting}>
              {inviting ? t('Sending…') : t('Send invitation')}
            </button>
          </div>
          <span className="users-hint">
            {t('They get an email with a link that works once, for 7 days — even while sign-ups are closed.')}
          </span>
        </form>
      </div>

      <div className="admin-card">
        <div className="admin-card-header">
          <h2 className="admin-card-title">{t('Pending invitations')}</h2>
          <span className="users-count">{invitations.length}</span>
        </div>

        {invitations.length === 0 ? (
          <div className="users-empty">
            <p>{t('No pending invitations.')}</p>
          </div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t('Email')}</th>
                <th>{t('Role')}</th>
                <th>{t('Invited by')}</th>
                <th>{t('Expires')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invitations.map(invitation => (
                <tr key={invitation.id}>
                  <td>
                    <strong>{invitation.email}</strong>
                    {invitation.name && <div className="users-muted">{invitation.name}</div>}
                  </td>
                  <td>{roleLabel(invitation.role)}</td>
                  <td className="users-muted">{invitation.invited_by ?? '—'}</td>
                  <td className="users-muted">{new Date(invitation.expires_at).toLocaleDateString(locale)}</td>
                  <td>
                    <button
                      onClick={() => revokeInvitation(invitation)}
                      className="admin-btn admin-btn-secondary"
                    >
                      {t('Revoke')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AdminLayout>
  )
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function articled(role: string): string {
  return /^[aeiou]/i.test(role) ? `an ${role}` : `a ${role}`
}

const userStyles = `
  .users-notice {
    padding: 12px 16px;
    border-radius: 8px;
    border: 1px solid var(--border);
    margin-bottom: 16px;
    font-size: 14px;
  }

  .users-notice-ok {
    background: var(--tint-success);
    border-color: var(--success);
    color: var(--success);
  }

  .users-notice-error {
    background: var(--tint-danger);
    border-color: var(--danger);
    color: var(--danger);
  }

  .users-reassign {
    padding: 16px;
    border-radius: 8px;
    border: 1px solid var(--danger);
    background: var(--tint-danger);
    margin-bottom: 16px;
  }

  .users-reassign-title {
    margin: 0 0 4px;
    font-weight: 600;
    color: var(--fg);
  }

  .users-reassign .users-hint {
    display: block;
    margin: 0 0 12px;
  }

  .users-row {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }

  .users-filters {
    margin-bottom: 16px;
  }

  .users-filters .admin-input {
    flex: 1;
    min-width: 200px;
  }

  .users-form {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .users-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .users-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--fg);
  }

  .users-hint {
    font-size: 12px;
    color: var(--fg-muted);
  }

  .users-muted {
    color: var(--fg-muted);
    font-size: 13px;
  }

  .users-count {
    font-size: 13px;
    color: var(--fg-muted);
    background: var(--surface-hover);
    border-radius: 999px;
    padding: 2px 10px;
  }

  .users-empty {
    padding: 40px 20px;
    text-align: center;
    color: var(--fg-muted);
    font-size: 14px;
  }
`
