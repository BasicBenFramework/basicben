import React, { useState, useEffect } from 'react'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'

type TargetType = 'post' | 'page' | 'category'

interface MenuItem {
  id: number
  menu_id: number
  parent_id: number | null
  label: string
  url: string | null
  target_type: TargetType | null
  target_id: number | null
  open_in_new_tab: number | boolean
  sort_order: number
}

interface Menu {
  id: number
  location: string
  name: string
  items: MenuItem[]
}

interface Option {
  id: number
  label: string
}

const BUILT_IN = ['primary', 'secondary', 'footer']

const EMPTY_ITEM = {
  label: '',
  kind: 'url' as 'url' | TargetType,
  url: '',
  target_id: '',
  parent_id: '',
  open_in_new_tab: false
}

/**
 * Items in display order: each top-level item followed by its children.
 * The order the server returns is by sort_order alone, which interleaves
 * siblings of different parents.
 */
function displayOrder(items: MenuItem[]): MenuItem[] {
  const byOrder = [...items].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
  const top = byOrder.filter(item => !item.parent_id)

  return top.flatMap(parent => [parent, ...byOrder.filter(item => item.parent_id === parent.id)])
}

/**
 * Navigation menus.
 *
 * Items link to a URL or to a post, page or category by id. Linked content
 * follows its slug when it is renamed and drops out of the public menu while
 * it is unpublished or trashed — see /api/v1/navigation.
 */
export default function AdminNavigation() {
  const [menus, setMenus] = useState<Menu[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [options, setOptions] = useState<Record<TargetType, Option[]>>({ post: [], page: [], category: [] })
  const [form, setForm] = useState(EMPTY_ITEM)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [newMenu, setNewMenu] = useState({ name: '', location: '' })

  useEffect(() => {
    loadMenus()
    loadOptions()
  }, [])

  const loadMenus = async (keep?: number) => {
    try {
      const res = await api.get<{ menus: Menu[] }>('/api/navigation/menus')
      const list = res?.menus || []
      setMenus(list)
      setActiveId(current => keep ?? current ?? list[0]?.id ?? null)
    } catch (err) {
      console.error('Failed to load menus:', err)
    } finally {
      setLoading(false)
    }
  }

  // The most recent hundred of each — enough to pick from on most sites
  // without paging a <select>. Drafts are listed too: a menu can be built
  // ahead of a launch, and the public menu hides the link until it is live.
  const loadOptions = async () => {
    try {
      const [posts, pages, categories] = await Promise.all([
        api.get<{ posts: Array<{ id: number; title: string }> }>('/api/posts?per_page=100'),
        api.get<{ pages: Array<{ id: number; title: string }> }>('/api/pages?per_page=100'),
        api.get<{ categories: Array<{ id: number; name: string }> }>('/api/categories')
      ])
      setOptions({
        post: (posts?.posts || []).map(p => ({ id: p.id, label: p.title })),
        page: (pages?.pages || []).map(p => ({ id: p.id, label: p.title })),
        category: (categories?.categories || []).map(c => ({ id: c.id, label: c.name }))
      })
    } catch (err) {
      console.error('Failed to load link targets:', err)
    }
  }

  const menu = menus.find(m => m.id === activeId) || null
  const ordered = menu ? displayOrder(menu.items) : []

  const describe = (item: MenuItem) => {
    if (!item.target_type) return item.url
    const found = options[item.target_type].find(o => o.id === item.target_id)
    return `${item.target_type}: ${found?.label ?? `#${item.target_id}`}`
  }

  const resetForm = () => {
    setForm(EMPTY_ITEM)
    setEditingId(null)
    setError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!menu) return
    setError('')

    const body = {
      label: form.label,
      ...(form.kind === 'url'
        ? { url: form.url, target_type: null }
        : { target_type: form.kind, target_id: Number(form.target_id) }),
      parent_id: form.parent_id ? Number(form.parent_id) : null,
      open_in_new_tab: form.open_in_new_tab
    }

    try {
      if (editingId) await api.put(`/api/navigation/items/${editingId}`, body)
      else await api.post(`/api/navigation/menus/${menu.id}/items`, body)
      resetForm()
      loadMenus(menu.id)
    } catch (err: any) {
      setError(err.message || 'Failed to save item')
    }
  }

  const handleEdit = (item: MenuItem) => {
    setEditingId(item.id)
    setError('')
    setForm({
      label: item.label,
      kind: item.target_type ?? 'url',
      url: item.url ?? '',
      target_id: item.target_id ? String(item.target_id) : '',
      parent_id: item.parent_id ? String(item.parent_id) : '',
      open_in_new_tab: Boolean(Number(item.open_in_new_tab))
    })
  }

  const handleDelete = async (item: MenuItem) => {
    const children = menu?.items.filter(i => i.parent_id === item.id).length || 0
    const warning = children ? ` Its ${children} nested item(s) will be removed too.` : ''
    if (!confirm(`Remove "${item.label}" from this menu?${warning}`)) return

    try {
      await api.delete(`/api/navigation/items/${item.id}`)
      loadMenus(menu?.id)
    } catch {
      alert('Failed to delete item')
    }
  }

  /** Send the whole menu's order, as the reorder endpoint requires. */
  const saveOrder = async (next: Array<{ id: number; parent_id: number | null }>) => {
    if (!menu) return
    try {
      await api.put(`/api/navigation/menus/${menu.id}/reorder`, { items: next })
      loadMenus(menu.id)
    } catch (err: any) {
      alert(err.message || 'Failed to reorder')
    }
  }

  const asOrder = (list: MenuItem[]) => list.map(i => ({ id: i.id, parent_id: i.parent_id }))

  /** Swap an item with its previous/next sibling (same parent). */
  const move = (item: MenuItem, direction: -1 | 1) => {
    const siblings = ordered.filter(i => i.parent_id === item.parent_id)
    const index = siblings.findIndex(i => i.id === item.id)
    const other = siblings[index + direction]
    if (!other) return

    // Rebuild the display order with the two siblings swapped, keeping each
    // top-level item's children attached to it.
    const swapped = siblings.map(i => (i.id === item.id ? other : i.id === other.id ? item : i))
    const next = item.parent_id
      ? ordered.flatMap(i => (i.parent_id === item.parent_id ? [] : i.id === item.parent_id ? [i, ...swapped] : [i]))
      : swapped.flatMap(parent => [parent, ...ordered.filter(i => i.parent_id === parent.id)])

    saveOrder(asOrder(next))
  }

  /** Nest under the previous top-level item. Only items without children can nest. */
  const indent = (item: MenuItem) => {
    const top = ordered.filter(i => !i.parent_id)
    const index = top.findIndex(i => i.id === item.id)
    const parent = top[index - 1]
    if (!parent || ordered.some(i => i.parent_id === item.id)) return

    saveOrder(asOrder(ordered).map(i => (i.id === item.id ? { ...i, parent_id: parent.id } : i)))
  }

  /** Back to the top level, just after its old parent. */
  const outdent = (item: MenuItem) => {
    const rest = ordered.filter(i => i.id !== item.id)
    const parentIndex = rest.findIndex(i => i.id === item.parent_id)
    const lastChild = rest.reduce((last, i, idx) => (i.parent_id === item.parent_id ? idx : last), parentIndex)
    const next = [...rest.slice(0, lastChild + 1), { ...item, parent_id: null }, ...rest.slice(lastChild + 1)]

    saveOrder(asOrder(next))
  }

  const handleCreateMenu = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const res = await api.post<{ menu: Menu }>('/api/navigation/menus', newMenu)
      setNewMenu({ name: '', location: '' })
      loadMenus(res.menu.id)
    } catch (err: any) {
      alert(err.message || 'Failed to create menu')
    }
  }

  const handleDeleteMenu = async () => {
    if (!menu || !confirm(`Delete the "${menu.name}" menu and all its items?`)) return
    try {
      await api.delete(`/api/navigation/menus/${menu.id}`)
      setActiveId(null)
      loadMenus()
    } catch (err: any) {
      alert(err.message || 'Failed to delete menu')
    }
  }

  if (loading) {
    return (
      <AdminLayout title="Navigation">
        <div className="admin-loading">Loading...</div>
      </AdminLayout>
    )
  }

  const topLevel = ordered.filter(i => !i.parent_id && i.id !== editingId)

  return (
    <AdminLayout title="Navigation">
      <div className="admin-card">
        <div className="admin-card-header">
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {menus.map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => { setActiveId(m.id); resetForm() }}
                className={`admin-btn ${m.id === activeId ? 'admin-btn-primary' : 'admin-btn-secondary'}`}
              >
                {m.name} <code style={{ marginLeft: '0.25rem', opacity: 0.7 }}>{m.location}</code>
              </button>
            ))}
          </div>
          {menu && !BUILT_IN.includes(menu.location) && (
            <button type="button" onClick={handleDeleteMenu} className="admin-btn admin-btn-danger">
              Delete menu
            </button>
          )}
        </div>
        <p style={{ color: 'var(--fg-muted)', fontSize: '0.875rem' }}>
          Your front end reads these from <code>/api/v1/navigation</code>, keyed by location. Links to
          posts, pages and categories follow their slug and are hidden while unpublished.
        </p>
      </div>

      {menu && (
        <div className="admin-grid admin-grid-2">
          <div className="admin-card">
            <h3 className="admin-card-title">{editingId ? 'Edit Item' : 'Add Item'}</h3>
            <form onSubmit={handleSubmit}>
              <div className="admin-form-group">
                <label className="admin-label">Label</label>
                <input
                  type="text"
                  value={form.label}
                  onChange={e => setForm({ ...form, label: e.target.value })}
                  className="admin-input"
                  required
                />
              </div>

              <div className="admin-form-group">
                <label className="admin-label">Links to</label>
                <select
                  value={form.kind}
                  onChange={e => setForm({ ...form, kind: e.target.value as typeof form.kind, target_id: '' })}
                  className="admin-select"
                >
                  <option value="url">A URL</option>
                  <option value="page">A page</option>
                  <option value="post">A post</option>
                  <option value="category">A category</option>
                </select>
              </div>

              {form.kind === 'url' ? (
                <div className="admin-form-group">
                  <label className="admin-label">URL</label>
                  <input
                    type="text"
                    value={form.url}
                    onChange={e => setForm({ ...form, url: e.target.value })}
                    className="admin-input"
                    placeholder="/about, https://example.com or mailto:hi@example.com"
                    required
                  />
                </div>
              ) : (
                <div className="admin-form-group">
                  <label className="admin-label">Which {form.kind}</label>
                  <select
                    value={form.target_id}
                    onChange={e => setForm({ ...form, target_id: e.target.value })}
                    className="admin-select"
                    required
                  >
                    <option value="">Choose…</option>
                    {options[form.kind].map(o => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="admin-form-group">
                <label className="admin-label">Parent</label>
                <select
                  value={form.parent_id}
                  onChange={e => setForm({ ...form, parent_id: e.target.value })}
                  className="admin-select"
                >
                  <option value="">None (top level)</option>
                  {topLevel.map(i => (
                    <option key={i.id} value={i.id}>{i.label}</option>
                  ))}
                </select>
              </div>

              <div className="admin-form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={form.open_in_new_tab}
                    onChange={e => setForm({ ...form, open_in_new_tab: e.target.checked })}
                  />
                  Open in a new tab
                </label>
              </div>

              {error && <p style={{ color: 'var(--danger)', marginBottom: '0.75rem' }}>{error}</p>}

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="submit" className="admin-btn admin-btn-primary">
                  {editingId ? 'Update' : 'Add Item'}
                </button>
                {editingId && (
                  <button type="button" onClick={resetForm} className="admin-btn admin-btn-secondary">
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>

          <div className="admin-card">
            <h3 className="admin-card-title">{menu.name} menu</h3>
            {ordered.length === 0 ? (
              <p style={{ color: 'var(--fg-muted)' }}>No items yet.</p>
            ) : (
              <div className="admin-stack">
                {ordered.map(item => (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.5rem 0.75rem',
                      marginLeft: item.parent_id ? '1.5rem' : 0,
                      backgroundColor: 'var(--surface-hover)',
                      borderRadius: '0.375rem'
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500 }}>{item.label}</div>
                      <div style={{ color: 'var(--fg-muted)', fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {describe(item)}
                      </div>
                    </div>
                    <button type="button" title="Move up" onClick={() => move(item, -1)} className="admin-btn admin-btn-secondary">↑</button>
                    <button type="button" title="Move down" onClick={() => move(item, 1)} className="admin-btn admin-btn-secondary">↓</button>
                    {item.parent_id
                      ? <button type="button" title="Move to top level" onClick={() => outdent(item)} className="admin-btn admin-btn-secondary">←</button>
                      : <button type="button" title="Nest under the item above" onClick={() => indent(item)} className="admin-btn admin-btn-secondary">→</button>}
                    <button type="button" onClick={() => handleEdit(item)} className="admin-btn admin-btn-secondary">Edit</button>
                    <button type="button" onClick={() => handleDelete(item)} className="admin-btn admin-btn-danger">Delete</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="admin-card">
        <h3 className="admin-card-title">Add a Menu Location</h3>
        <form onSubmit={handleCreateMenu} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="admin-form-group" style={{ marginBottom: 0 }}>
            <label className="admin-label">Name</label>
            <input
              type="text"
              value={newMenu.name}
              onChange={e => setNewMenu({ ...newMenu, name: e.target.value })}
              className="admin-input"
              placeholder="Social links"
              required
            />
          </div>
          <div className="admin-form-group" style={{ marginBottom: 0 }}>
            <label className="admin-label">Location</label>
            <input
              type="text"
              value={newMenu.location}
              onChange={e => setNewMenu({ ...newMenu, location: e.target.value })}
              className="admin-input"
              placeholder="social"
              pattern="[a-z][a-z0-9_\-]*"
              required
            />
          </div>
          <button type="submit" className="admin-btn admin-btn-secondary">Add Menu</button>
        </form>
      </div>
    </AdminLayout>
  )
}
