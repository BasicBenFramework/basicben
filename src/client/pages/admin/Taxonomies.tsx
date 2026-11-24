import React, { useState, useEffect } from 'react'
import { api } from '../../../helpers/api.ts'
import AdminLayout from '../../layouts/AdminLayout.tsx'
import { useT, slots } from '../../i18n/index.ts'

/**
 * Custom taxonomies and their terms.
 *
 * Categories and tags keep their own screens; this is for everything beyond
 * them. Choose a taxonomy on the left to manage its terms on the right, the
 * way the Categories screen pairs a form with its list.
 */

interface Taxonomy {
  id: number
  key: string
  singular_label: string
  plural_label: string
  description: string | null
  hierarchical: boolean
  public: boolean
  content_types: string[]
}

interface Term {
  id: number
  name: string
  slug: string
  description: string | null
  parent_id: number | null
  post_count?: number
}

interface ContentTypeOption {
  key: string
  plural_label: string
}

const EMPTY_TAXONOMY = { key: '', singular_label: '', plural_label: '', description: '', hierarchical: false, public: true, content_types: ['post'] as string[] }
const EMPTY_TERM = { name: '', slug: '', description: '', parent_id: '' as number | '' }

export default function AdminTaxonomies() {
  const { t } = useT()
  const [taxonomies, setTaxonomies] = useState<Taxonomy[]>([])
  const [types, setTypes] = useState<ContentTypeOption[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Taxonomy | null>(null)
  const [terms, setTerms] = useState<Term[]>([])

  const [editingTaxonomy, setEditingTaxonomy] = useState<Taxonomy | null>(null)
  const [taxonomyForm, setTaxonomyForm] = useState(EMPTY_TAXONOMY)
  const [showTaxonomyForm, setShowTaxonomyForm] = useState(false)

  const [editingTerm, setEditingTerm] = useState<Term | null>(null)
  const [termForm, setTermForm] = useState(EMPTY_TERM)

  useEffect(() => { load() }, [])
  useEffect(() => { if (selected) loadTerms(selected) }, [selected?.id])

  const load = async () => {
    try {
      const [taxRes, typeRes] = await Promise.all([
        api.get<{ taxonomies: Taxonomy[] }>('/api/taxonomies'),
        api.get<{ content_types: ContentTypeOption[] }>('/api/content-types')
      ])
      setTaxonomies(taxRes?.taxonomies || [])
      setTypes(typeRes?.content_types || [])
      if (selected) setSelected((taxRes?.taxonomies || []).find(tx => tx.id === selected.id) ?? null)
    } catch (error) {
      console.error('Failed to load taxonomies:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadTerms = async (taxonomy: Taxonomy) => {
    try {
      const res = await api.get<{ terms: Term[] }>(`/api/taxonomies/${taxonomy.id}/terms`)
      setTerms(res?.terms || [])
    } catch (error) {
      console.error('Failed to load terms:', error)
      setTerms([])
    }
  }

  const saveTaxonomy = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      const { key, ...rest } = taxonomyForm
      if (editingTaxonomy) await api.put(`/api/taxonomies/${editingTaxonomy.id}`, rest)
      else await api.post('/api/taxonomies', { key, ...rest })
      setShowTaxonomyForm(false)
      setEditingTaxonomy(null)
      await load()
    } catch (error: any) {
      alert(error.message || t('Could not save the taxonomy'))
    }
  }

  const removeTaxonomy = async (taxonomy: Taxonomy) => {
    if (!confirm(t('Delete {name} and all of its terms? Posts keep everything else.', { name: taxonomy.plural_label }))) return
    try {
      await api.delete(`/api/taxonomies/${taxonomy.id}`)
      if (selected?.id === taxonomy.id) setSelected(null)
      await load()
    } catch (error: any) {
      alert(error.message || t('Could not delete the taxonomy'))
    }
  }

  const saveTerm = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selected) return
    try {
      const payload = { ...termForm, parent_id: termForm.parent_id === '' ? null : termForm.parent_id }
      if (editingTerm) await api.put(`/api/terms/${editingTerm.id}`, payload)
      else await api.post(`/api/taxonomies/${selected.id}/terms`, payload)
      setTermForm(EMPTY_TERM)
      setEditingTerm(null)
      await loadTerms(selected)
    } catch (error: any) {
      alert(error.message || t('Could not save the term'))
    }
  }

  const removeTerm = async (term: Term) => {
    if (!selected || !confirm(t('Delete “{name}”? Posts filed under it lose it.', { name: term.name }))) return
    try {
      await api.delete(`/api/terms/${term.id}`)
      await loadTerms(selected)
    } catch (error: any) {
      alert(error.message || t('Could not delete the term'))
    }
  }

  const toggleType = (key: string) => {
    setTaxonomyForm(prev => ({
      ...prev,
      content_types: prev.content_types.includes(key) ? prev.content_types.filter(k => k !== key) : [...prev.content_types, key]
    }))
  }

  if (loading) {
    return (
      <AdminLayout title={t('Taxonomies')}>
        <div className="admin-loading">{t('Loading...')}</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout
      title={t('Taxonomies')}
      actions={
        <button type="button" className="admin-btn admin-btn-primary" onClick={() => {
          setEditingTaxonomy(null)
          setTaxonomyForm(EMPTY_TAXONOMY)
          setShowTaxonomyForm(true)
        }}>{t('+ New taxonomy')}</button>
      }
    >
      <div className="admin-grid admin-grid-2">
        <div>
          <div className="admin-card">
            <p style={{ color: 'var(--fg-muted)', marginTop: 0 }}>
              {t('Categories and tags are built in. Add others — a cuisine, a season — and choose which content types use them.')}
            </p>

            {taxonomies.length === 0 ? (
              <p style={{ color: 'var(--fg-muted)' }}>{t('No custom taxonomies yet.')}</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
                {taxonomies.map(taxonomy => (
                  <li key={taxonomy.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'space-between' }}>
                    <button type="button" className={`admin-btn ${selected?.id === taxonomy.id ? 'admin-btn-primary' : 'admin-btn-secondary'}`}
                      onClick={() => setSelected(taxonomy)} aria-pressed={selected?.id === taxonomy.id}>
                      {taxonomy.plural_label}
                    </button>
                    <small style={{ color: 'var(--fg-muted)', marginRight: 'auto' }}>
                      <code>{taxonomy.key}</code> · {taxonomy.content_types.join(', ') || t('no types')}
                    </small>
                    <button type="button" className="admin-btn admin-btn-secondary" onClick={() => {
                      setEditingTaxonomy(taxonomy)
                      setTaxonomyForm({ ...taxonomy, description: taxonomy.description ?? '' })
                      setShowTaxonomyForm(true)
                    }}>{t('Edit')}</button>
                    <button type="button" className="admin-btn admin-btn-danger" onClick={() => removeTaxonomy(taxonomy)}>{t('Delete')}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {showTaxonomyForm && (
            <form className="admin-card" onSubmit={saveTaxonomy}>
              <h3 className="admin-card-title">{editingTaxonomy ? t('Edit {name}', { name: editingTaxonomy.plural_label }) : t('New taxonomy')}</h3>
              <div className="admin-form-group">
                <label className="admin-label" htmlFor="tx-singular">{t('Singular label')}</label>
                <input id="tx-singular" className="admin-input" required value={taxonomyForm.singular_label}
                  onChange={e => setTaxonomyForm({ ...taxonomyForm, singular_label: e.target.value })} placeholder={t('Cuisine')} />
              </div>
              <div className="admin-form-group">
                <label className="admin-label" htmlFor="tx-plural">{t('Plural label')}</label>
                <input id="tx-plural" className="admin-input" required value={taxonomyForm.plural_label}
                  onChange={e => setTaxonomyForm({ ...taxonomyForm, plural_label: e.target.value })} placeholder={t('Cuisines')} />
              </div>
              <div className="admin-form-group">
                <label className="admin-label" htmlFor="tx-key">{t('Key')}</label>
                <input id="tx-key" className="admin-input" required disabled={Boolean(editingTaxonomy)} value={taxonomyForm.key}
                  onChange={e => setTaxonomyForm({ ...taxonomyForm, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} placeholder={t('cuisine')} />
                <small style={{ color: 'var(--fg-muted)' }}>{slots(t('Used in {code}. Fixed once created.'), { code: <code>?tax=key:slug</code> })}</small>
              </div>
              <div className="admin-form-group">
                <label className="admin-label" htmlFor="tx-description">{t('Description')}</label>
                <textarea id="tx-description" className="admin-textarea" value={taxonomyForm.description}
                  onChange={e => setTaxonomyForm({ ...taxonomyForm, description: e.target.value })} style={{ minHeight: '60px' }} />
              </div>
              <fieldset className="admin-form-group" style={{ border: 'none', padding: 0 }}>
                <legend className="admin-label">{t('Used by')}</legend>
                {types.map(type => (
                  <label key={type.key} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                    <input type="checkbox" checked={taxonomyForm.content_types.includes(type.key)} onChange={() => toggleType(type.key)} />
                    {type.plural_label}
                  </label>
                ))}
              </fieldset>
              <div className="admin-form-group">
                <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <input type="checkbox" checked={taxonomyForm.hierarchical} onChange={e => setTaxonomyForm({ ...taxonomyForm, hierarchical: e.target.checked })} />
                  {t('Terms can have parents')}
                </label>
                <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <input type="checkbox" checked={taxonomyForm.public} onChange={e => setTaxonomyForm({ ...taxonomyForm, public: e.target.checked })} />
                  {t('Public — in the content API and on the public site')}
                </label>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="submit" className="admin-btn admin-btn-primary">{t('Save')}</button>
                <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setShowTaxonomyForm(false)}>{t('Cancel')}</button>
              </div>
            </form>
          )}
        </div>

        <div className="admin-card">
          {!selected ? (
            <p style={{ color: 'var(--fg-muted)' }}>{t('Choose a taxonomy to manage its terms.')}</p>
          ) : (
            <>
              <h3 className="admin-card-title">{selected.plural_label}</h3>
              <form onSubmit={saveTerm} style={{ marginBottom: '1rem' }}>
                <div className="admin-form-group">
                  <label className="admin-label" htmlFor="term-name">{editingTerm ? t('Edit {name}', { name: selected.singular_label.toLowerCase() }) : t('New {name}', { name: selected.singular_label.toLowerCase() })}</label>
                  <input id="term-name" className="admin-input" required value={termForm.name}
                    onChange={e => setTermForm({ ...termForm, name: e.target.value })} placeholder={t('Name')} />
                </div>
                <div className="admin-form-group">
                  <input className="admin-input" aria-label={t('Slug')} value={termForm.slug}
                    onChange={e => setTermForm({ ...termForm, slug: e.target.value })} placeholder={t('slug (from the name if blank)')} />
                </div>
                {selected.hierarchical && (
                  <div className="admin-form-group">
                    <select className="admin-input" aria-label={t('Parent')} value={termForm.parent_id}
                      onChange={e => setTermForm({ ...termForm, parent_id: e.target.value ? Number(e.target.value) : '' })}>
                      <option value="">{t('No parent')}</option>
                      {terms.filter(term => term.id !== editingTerm?.id).map(term => <option key={term.id} value={term.id}>{term.name}</option>)}
                    </select>
                  </div>
                )}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="submit" className="admin-btn admin-btn-primary">{editingTerm ? t('Update') : t('Add')}</button>
                  {editingTerm && (
                    <button type="button" className="admin-btn admin-btn-secondary" onClick={() => { setEditingTerm(null); setTermForm(EMPTY_TERM) }}>{t('Cancel')}</button>
                  )}
                </div>
              </form>

              {terms.length === 0 ? (
                <p style={{ color: 'var(--fg-muted)' }}>{t('No terms yet.')}</p>
              ) : (
                <table className="admin-table">
                  <thead>
                    <tr><th>{t('Name')}</th><th>{t('Slug')}</th><th>{t('Posts')}</th><th>{t('Actions')}</th></tr>
                  </thead>
                  <tbody>
                    {terms.map(term => (
                      <tr key={term.id}>
                        <td>{term.parent_id ? '— ' : ''}{term.name}</td>
                        <td><code>{term.slug}</code></td>
                        <td>{term.post_count ?? 0}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => {
                              setEditingTerm(term)
                              setTermForm({ name: term.name, slug: term.slug, description: term.description ?? '', parent_id: term.parent_id ?? '' })
                            }}>{t('Edit')}</button>
                            <button type="button" className="admin-btn admin-btn-danger" onClick={() => removeTerm(term)}>{t('Delete')}</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
    </AdminLayout>
  )
}

