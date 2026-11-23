import React, { useState, useEffect } from 'react'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'
import { useT, slots } from '../../i18n'

/**
 * Content types — WordPress's custom post types — and their custom fields.
 *
 * One screen for the list and the editor, because a type is a handful of
 * labels and a field list: a second route for it would be a page of five
 * inputs. The built-in Post type is listed so its panels can be switched, but
 * its key, route base and visibility are fixed (the server enforces that too).
 */

type FieldType = 'text' | 'textarea' | 'number' | 'url' | 'date' | 'boolean' | 'select'

interface FieldDefinition {
  key: string
  label: string
  type: FieldType
  options: string[]
  required: boolean
  help_text: string | null
}

interface Supports {
  excerpt: boolean
  featured_image: boolean
  comments: boolean
  categories: boolean
  tags: boolean
  custom_fields: boolean
}

interface ContentTypeRecord {
  id: number
  key: string
  singular_label: string
  plural_label: string
  description: string | null
  route_base: string
  public: boolean
  builtin: boolean
  supports: Supports
  fields: FieldDefinition[]
}

const FIELD_TYPES: FieldType[] = ['text', 'textarea', 'number', 'url', 'date', 'boolean', 'select']

const SUPPORT_KEYS: Array<keyof Supports> = ['excerpt', 'featured_image', 'comments', 'categories', 'tags', 'custom_fields']

const ALL_SUPPORTS: Supports = { excerpt: true, featured_image: true, comments: true, categories: true, tags: true, custom_fields: true }

interface Form {
  key: string
  singular_label: string
  plural_label: string
  description: string
  route_base: string
  public: boolean
  supports: Supports
  // Options are edited as one line each, so they are text until saved.
  fields: Array<FieldDefinition & { optionsText: string }>
}

const EMPTY: Form = {
  key: '',
  singular_label: '',
  plural_label: '',
  description: '',
  route_base: '',
  public: true,
  supports: ALL_SUPPORTS,
  fields: []
}

function toForm(type: ContentTypeRecord): Form {
  return {
    key: type.key,
    singular_label: type.singular_label,
    plural_label: type.plural_label,
    description: type.description ?? '',
    route_base: type.route_base,
    public: type.public,
    supports: { ...type.supports },
    fields: type.fields.map(field => ({ ...field, optionsText: field.options.join('\n') }))
  }
}

export default function AdminContentTypes() {
  const { t } = useT()
  const fieldTypeLabels: Record<FieldType, string> = {
    text: t('Text'),
    textarea: t('Long text'),
    number: t('Number'),
    url: 'URL',
    date: t('Date'),
    boolean: t('Yes / no'),
    select: t('Choice')
  }
  const supportLabels: Record<keyof Supports, string> = {
    excerpt: t('Excerpt'),
    featured_image: t('Featured image'),
    comments: t('Comments'),
    categories: t('Categories'),
    tags: t('Tags'),
    custom_fields: t('Custom fields')
  }
  const [types, setTypes] = useState<ContentTypeRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<ContentTypeRecord | null>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      const res = await api.get<{ content_types: ContentTypeRecord[] }>('/api/content-types')
      setTypes(res?.content_types || [])
    } catch (error) {
      console.error('Failed to load content types:', error)
    } finally {
      setLoading(false)
    }
  }

  const startNew = () => {
    setEditing(null)
    setForm(EMPTY)
    setShowForm(true)
    setMessage('')
  }

  const startEdit = (type: ContentTypeRecord) => {
    setEditing(type)
    setForm(toForm(type))
    setShowForm(true)
    setMessage('')
  }

  const cancel = () => {
    setShowForm(false)
    setEditing(null)
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()

    if (editing && !editing.builtin && form.route_base !== editing.route_base &&
      !confirm(t('Every {name} will move from {from} to {to}. Old links will break unless you add a redirect. Continue?', { name: editing.singular_label.toLowerCase(), from: editing.route_base, to: form.route_base }))) {
      return
    }

    setSaving(true)
    try {
      const payload = {
        ...(editing ? {} : { key: form.key }),
        singular_label: form.singular_label,
        plural_label: form.plural_label,
        description: form.description,
        ...(editing?.builtin ? {} : { route_base: form.route_base, public: form.public }),
        supports: form.supports,
        fields: form.fields.map(({ optionsText, ...field }) => ({
          ...field,
          options: field.type === 'select' ? optionsText.split('\n').map(o => o.trim()).filter(Boolean) : []
        }))
      }

      const res = editing
        ? await api.put<{ notice?: string }>(`/api/content-types/${editing.id}`, payload)
        : await api.post<{ notice?: string }>('/api/content-types', payload)

      setMessage(res?.notice || t('Saved.'))
      setShowForm(false)
      setEditing(null)
      await load()
    } catch (error: any) {
      alert(error.message || t('Could not save the content type'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (type: ContentTypeRecord) => {
    if (!confirm(t('Delete the {name} type? This only works when no entries use it.', { name: type.plural_label }))) return
    try {
      await api.delete(`/api/content-types/${type.id}`)
      await load()
    } catch (error: any) {
      alert(error.message || t('Could not delete the content type'))
    }
  }

  const updateField = (index: number, change: Partial<Form['fields'][number]>) => {
    setForm(prev => ({ ...prev, fields: prev.fields.map((field, i) => (i === index ? { ...field, ...change } : field)) }))
  }

  const moveField = (index: number, by: number) => {
    setForm(prev => {
      const fields = [...prev.fields]
      const target = index + by
      if (target < 0 || target >= fields.length) return prev
      ;[fields[index], fields[target]] = [fields[target], fields[index]]
      return { ...prev, fields }
    })
  }

  const addField = () => {
    setForm(prev => ({
      ...prev,
      fields: [...prev.fields, { key: '', label: '', type: 'text', options: [], optionsText: '', required: false, help_text: null }]
    }))
  }

  if (loading) {
    return (
      <AdminLayout title={t('Content types')}>
        <div className="admin-loading">{t('Loading...')}</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout title={t('Content types')}>
      {message && <div className="admin-card" role="status">{message}</div>}

      <div className="admin-card">
        <div className="admin-card-header">
          <h2 className="admin-card-title">{t('Content types')}</h2>
          <button type="button" className="admin-btn admin-btn-primary" onClick={startNew}>{t('+ New type')}</button>
        </div>
        <p style={{ color: 'var(--fg-muted)', marginTop: 0 }}>
          {t('Each type is written in the same editor as posts and gets its own address on the public site.')}{' '}
          {slots(t('Types listed here appear in the content API as {code}.'), { code: <code>/api/v1/posts?type=key</code> })}
        </p>

        <table className="admin-table">
          <thead>
            <tr>
              <th>{t('Name')}</th>
              <th>{t('Key')}</th>
              <th>{t('Lives at')}</th>
              <th>{t('Fields')}</th>
              <th>{t('Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {types.map(type => (
              <tr key={type.id}>
                <td>
                  {type.plural_label}
                  {type.builtin && <span className="admin-badge admin-badge-info" style={{ marginLeft: '0.5rem' }}>{t('Built in')}</span>}
                  {!type.public && <span className="admin-badge admin-badge-warning" style={{ marginLeft: '0.5rem' }}>{t('Private')}</span>}
                </td>
                <td><code>{type.key}</code></td>
                <td><code>{type.route_base}/…</code></td>
                <td>{type.supports.custom_fields ? type.fields.length : '—'}</td>
                <td>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button type="button" className="admin-btn admin-btn-secondary" onClick={() => startEdit(type)}>{t('Edit')}</button>
                    {!type.builtin && (
                      <button type="button" className="admin-btn admin-btn-danger" onClick={() => remove(type)}>{t('Delete')}</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <form className="admin-card" onSubmit={save}>
          <h3 className="admin-card-title">{editing ? t('Edit {name}', { name: editing.plural_label }) : t('New content type')}</h3>

          <div className="admin-grid admin-grid-2">
            <div className="admin-form-group">
              <label className="admin-label" htmlFor="ct-singular">{t('Singular label')}</label>
              <input id="ct-singular" className="admin-input" required value={form.singular_label}
                onChange={e => setForm({ ...form, singular_label: e.target.value })} placeholder={t('Recipe')} />
            </div>
            <div className="admin-form-group">
              <label className="admin-label" htmlFor="ct-plural">{t('Plural label')}</label>
              <input id="ct-plural" className="admin-input" required value={form.plural_label}
                onChange={e => setForm({ ...form, plural_label: e.target.value })} placeholder={t('Recipes')} />
            </div>
            <div className="admin-form-group">
              <label className="admin-label" htmlFor="ct-key">{t('Key')}</label>
              <input id="ct-key" className="admin-input" required disabled={Boolean(editing)} value={form.key}
                onChange={e => setForm({ ...form, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} placeholder={t('recipe')} />
              <small style={{ color: 'var(--fg-muted)' }}>{t('What the API calls it. Fixed once created.')}</small>
            </div>
            <div className="admin-form-group">
              <label className="admin-label" htmlFor="ct-route">{t('Route base')}</label>
              <input id="ct-route" className="admin-input" disabled={Boolean(editing?.builtin)} value={form.route_base}
                onChange={e => setForm({ ...form, route_base: e.target.value })} placeholder={`/${form.key.replace(/_/g, '-') || t('recipes')}`} />
              <small style={{ color: 'var(--fg-muted)' }}>{slots(t('Entries live at {code}.'), { code: <code>{form.route_base || `/${form.key.replace(/_/g, '-')}`}/slug</code> })}</small>
            </div>
          </div>

          <div className="admin-form-group">
            <label className="admin-label" htmlFor="ct-description">{t('Description')}</label>
            <textarea id="ct-description" className="admin-textarea" value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })} style={{ minHeight: '60px' }} />
          </div>

          {!editing?.builtin && (
            <div className="admin-form-group">
              <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input type="checkbox" checked={form.public} onChange={e => setForm({ ...form, public: e.target.checked })} />
                {t('Public — listed in the content API, the sitemap and the public site')}
              </label>
            </div>
          )}

          <fieldset className="admin-form-group" style={{ border: 'none', padding: 0 }}>
            <legend className="admin-label">{t('Editor panels')}</legend>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
              {SUPPORT_KEYS.map(key => (
                <label key={key} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <input type="checkbox" checked={form.supports[key]}
                    onChange={e => setForm({ ...form, supports: { ...form.supports, [key]: e.target.checked } })} />
                  {supportLabels[key]}
                </label>
              ))}
            </div>
          </fieldset>

          {form.supports.custom_fields && (
            <div className="admin-form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="admin-label">{t('Custom fields')}</span>
                <button type="button" className="admin-btn admin-btn-secondary" onClick={addField}>{t('+ Add field')}</button>
              </div>

              {form.fields.length === 0 && <p style={{ color: 'var(--fg-muted)' }}>{t('No custom fields yet.')}</p>}

              {form.fields.map((field, index) => (
                <div key={index} style={{ border: '1px solid var(--border)', borderRadius: '0.5rem', padding: '0.75rem', marginTop: '0.5rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '0.5rem' }}>
                    <input className="admin-input" aria-label={t('Field label')} placeholder={t('Label')} value={field.label} required
                      onChange={e => updateField(index, {
                        label: e.target.value,
                        // A new field takes its key from its label until the
                        // key is typed into directly.
                        ...(field.key === '' || field.key === slugKey(field.label) ? { key: slugKey(e.target.value) } : {})
                      })} />
                    <input className="admin-input" aria-label={t('Field key')} placeholder={t('key')} value={field.key} required
                      onChange={e => updateField(index, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} />
                    <select className="admin-input" aria-label={t('Field type')} value={field.type}
                      onChange={e => updateField(index, { type: e.target.value as FieldType })}>
                      {FIELD_TYPES.map(type => <option key={type} value={type}>{fieldTypeLabels[type]}</option>)}
                    </select>
                  </div>
                  {field.type === 'select' && (
                    <textarea className="admin-textarea" aria-label={t('Choices, one per line')} placeholder={t('One choice per line')}
                      value={field.optionsText} onChange={e => updateField(index, { optionsText: e.target.value })}
                      style={{ minHeight: '70px', marginTop: '0.5rem' }} />
                  )}
                  <input className="admin-input" aria-label={t('Help text')} placeholder={t('Help text (optional)')} value={field.help_text ?? ''}
                    onChange={e => updateField(index, { help_text: e.target.value || null })} style={{ marginTop: '0.5rem' }} />
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem' }}>
                    <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginRight: 'auto' }}>
                      <input type="checkbox" checked={field.required} onChange={e => updateField(index, { required: e.target.checked })} />
                      {t('Required')}
                    </label>
                    <button type="button" className="admin-btn admin-btn-secondary" onClick={() => moveField(index, -1)} aria-label={t('Move up')}>↑</button>
                    <button type="button" className="admin-btn admin-btn-secondary" onClick={() => moveField(index, 1)} aria-label={t('Move down')}>↓</button>
                    <button type="button" className="admin-btn admin-btn-danger"
                      onClick={() => setForm(prev => ({ ...prev, fields: prev.fields.filter((_, i) => i !== index) }))}>{t('Remove')}</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" className="admin-btn admin-btn-primary" disabled={saving}>{saving ? t('Saving…') : t('Save')}</button>
            <button type="button" className="admin-btn admin-btn-secondary" onClick={cancel}>{t('Cancel')}</button>
          </div>
        </form>
      )}
    </AdminLayout>
  )
}

function slugKey(label: string): string {
  return label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 50)
}

