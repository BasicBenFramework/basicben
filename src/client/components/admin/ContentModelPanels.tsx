import React, { useEffect, useState } from 'react'
import { api } from '../../../helpers/api'
import TermPicker from './TermPicker'
import type { AdminContentType } from '../../hooks/useContentTypes'

/**
 * The editor's content-type panels: a type's custom fields, and the pickers
 * for custom taxonomies attached to it.
 *
 * Kept out of PostEditor so the editor gains a few lines rather than a few
 * hundred, and so the panels can be reasoned about on their own. Both are
 * controlled: the editor owns the values and sends them with the post.
 */

type FieldDefinition = AdminContentType['fields'][number]

/** One input per declared field, typed to match what the server validates. */
export function CustomFieldsPanel({
  type,
  values,
  onChange,
  disabled
}: {
  type: AdminContentType | undefined
  values: Record<string, unknown>
  onChange: (values: Record<string, unknown>) => void
  disabled?: boolean
}) {
  if (!type || !type.supports.custom_fields || type.fields.length === 0) return null

  const set = (key: string, value: unknown) => onChange({ ...values, [key]: value })

  return (
    <div className="admin-card">
      <h3 className="admin-card-title">{type.singular_label} details</h3>
      {type.fields.map(field => (
        <div className="admin-form-group" key={field.key}>
          {field.type === 'boolean' ? (
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input type="checkbox" checked={Boolean(values[field.key])} disabled={disabled}
                onChange={e => set(field.key, e.target.checked)} />
              {field.label}{field.required ? ' *' : ''}
            </label>
          ) : (
            <>
              <label className="admin-label" htmlFor={`field-${field.key}`}>{field.label}{field.required ? ' *' : ''}</label>
              <FieldInput field={field} value={values[field.key]} disabled={disabled} onChange={value => set(field.key, value)} />
            </>
          )}
          {field.help_text && <small style={{ color: 'var(--fg-muted)' }}>{field.help_text}</small>}
        </div>
      ))}
    </div>
  )
}

function FieldInput({ field, value, onChange, disabled }: {
  field: FieldDefinition
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
}) {
  const id = `field-${field.key}`
  const text = value === undefined || value === null ? '' : String(value)

  switch (field.type) {
    case 'textarea':
      return <textarea id={id} className="admin-textarea" value={text} required={field.required} disabled={disabled}
        onChange={e => onChange(e.target.value)} style={{ minHeight: '100px' }} />
    case 'select':
      return (
        <select id={id} className="admin-input" value={text} required={field.required} disabled={disabled} onChange={e => onChange(e.target.value)}>
          <option value="">—</option>
          {field.options.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      )
    case 'number':
      // Sent as typed; the server turns it into a number or refuses it.
      return <input id={id} type="number" step="any" className="admin-input" value={text} required={field.required} disabled={disabled}
        onChange={e => onChange(e.target.value)} />
    case 'date':
      return <input id={id} type="date" className="admin-input" value={text} required={field.required} disabled={disabled}
        onChange={e => onChange(e.target.value)} />
    case 'url':
      return <input id={id} type="url" className="admin-input" value={text} required={field.required} disabled={disabled}
        onChange={e => onChange(e.target.value)} placeholder="https://" />
    default:
      return <input id={id} type="text" className="admin-input" value={text} required={field.required} disabled={disabled}
        onChange={e => onChange(e.target.value)} />
  }
}

interface Taxonomy {
  id: number
  key: string
  singular_label: string
  plural_label: string
}

interface Term {
  id: number
  name: string
}

/**
 * A picker per custom taxonomy attached to the type.
 *
 * `onReady` reports once the taxonomies have loaded, so the editor only sends
 * `term_ids` when it actually knows the selection — a failed load must not
 * look like "no terms" and clear them on save.
 */
export function CustomTermsPanel({
  typeKey,
  selected,
  onChange,
  onReady
}: {
  typeKey: string
  selected: number[]
  onChange: (ids: number[]) => void
  onReady: (ready: boolean) => void
}) {
  const [taxonomies, setTaxonomies] = useState<Taxonomy[]>([])
  const [terms, setTerms] = useState<Record<number, Term[]>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    onReady(false)

    ;(async () => {
      try {
        const res = await api.get<{ taxonomies: Taxonomy[] }>(`/api/taxonomies?type=${encodeURIComponent(typeKey)}`)
        const list = res?.taxonomies || []
        const loaded: Record<number, Term[]> = {}
        for (const taxonomy of list) {
          const termRes = await api.get<{ terms: Term[] }>(`/api/taxonomies/${taxonomy.id}/terms`)
          loaded[taxonomy.id] = termRes?.terms || []
        }
        if (!live) return
        setTaxonomies(list)
        setTerms(loaded)
        onReady(true)
      } catch {
        if (live) setTaxonomies([])
      }
    })()

    return () => { live = false }
  }, [typeKey])

  const toggle = (id: number) => onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])

  const add = async (taxonomy: Taxonomy, name: string) => {
    if (!name || busy) return false
    setBusy(true)
    try {
      const res = await api.post<{ term: Term }>(`/api/taxonomies/${taxonomy.id}/terms`, { name })
      const created = res?.term
      if (!created) return false
      setTerms(prev => ({ ...prev, [taxonomy.id]: [...(prev[taxonomy.id] || []), created].sort((a, b) => a.name.localeCompare(b.name)) }))
      onChange([...selected, created.id])
      return true
    } catch (error: any) {
      alert(error.message || `Could not add that ${taxonomy.singular_label.toLowerCase()}.`)
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {taxonomies.map(taxonomy => (
        <TermPicker
          key={taxonomy.id}
          title={taxonomy.plural_label}
          noun={taxonomy.singular_label.toLowerCase()}
          terms={terms[taxonomy.id] || []}
          selected={selected}
          onToggle={toggle}
          onAdd={name => add(taxonomy, name)}
          busy={busy}
          emptyText={`No ${taxonomy.plural_label.toLowerCase()} yet.`}
        />
      ))}
    </>
  )
}
