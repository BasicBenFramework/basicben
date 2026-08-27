import React, { useMemo, useState } from 'react'

export interface Term {
  id: number
  name: string
}

interface TermPickerProps {
  /** The card heading — "Categories", "Tags". */
  title: string
  /** One of them, for the placeholder and the button. "category", "tag". */
  noun: string
  /** Everything that exists, both to list and to match what is typed against. */
  terms: Term[]
  /** The ids currently on the post. */
  selected: number[]
  onToggle: (id: number) => void
  /**
   * Add what was typed, creating it if it is new. Resolves true once the caller
   * has updated `terms` and `selected` — false if it could not, and then what
   * was typed stays in the field to be corrected rather than disappearing
   * behind the alert that explained why.
   */
  onAdd: (input: string) => Promise<boolean>
  /** An add is in flight. The field stays usable; the button does not. */
  busy: boolean
  /** Shown in place of the list when there is nothing to list yet. */
  emptyText: string
  /**
   * Whether a comma commits, for a control whose values are conventionally
   * typed as a comma-separated run. True for tags, where it always has been;
   * false for categories, whose names contain commas often enough to matter.
   */
  commitOnComma?: boolean
}

/**
 * A searchable box of categories or tags, where the search field is also the
 * way to add one.
 *
 * Both taxonomies used to present a full checkbox list and a separate add
 * control — which works until a site has eighty categories or four hundred
 * tags, at which point finding the one you want means scrolling a 12rem window
 * and adding a duplicate is easier than finding the original. Filtering the
 * list is the fix for the first problem; making the filter field the add field
 * is the fix for the second, because you cannot type a name you already have
 * without being shown it.
 *
 * So typing narrows the list, and what happens on Enter depends on whether
 * what you typed already exists: an existing term is selected, a new one is
 * created. "+ Add" only appears when there is nothing that matches exactly,
 * which is the only time creating one is the right answer.
 */
export default function TermPicker({
  title,
  noun,
  terms,
  selected,
  onToggle,
  onAdd,
  busy,
  emptyText,
  commitOnComma = false
}: TermPickerProps) {
  const [query, setQuery] = useState('')

  const typed = query.trim()
  const needle = typed.toLowerCase()

  const matches = useMemo(
    () => (needle ? terms.filter(term => term.name.toLowerCase().includes(needle)) : terms),
    [terms, needle]
  )

  // Case-insensitively, because "Privacy" and "privacy" are the same term to
  // everyone except a database — and offering to create the second one is how
  // a tag list ends up with both.
  const exact = terms.find(term => term.name.toLowerCase() === needle)

  const commit = async () => {
    if (!typed || busy) return

    // Typing the name of something that exists means "use that one", not "make
    // another".
    if (exact) {
      if (!selected.includes(exact.id)) onToggle(exact.id)
      setQuery('')
      return
    }

    if (await onAdd(typed)) setQuery('')
  }

  return (
    <div className="admin-card">
      <h3 className="admin-card-title">{title}</h3>

      {/* What is actually on the post, each removable — so the selection is
          readable without scrolling the list to find the ticked boxes, and
          stays readable while a search hides most of them. */}
      {selected.length > 0 && (
        <div className="admin-term-chips">
          {selected.map(id => {
            const term = terms.find(t => t.id === id)

            return (
              <span key={id} className="admin-term-chip">
                {term?.name ?? `#${id}`}
                <button
                  type="button"
                  aria-label={`Remove ${term?.name ?? noun}`}
                  onClick={() => onToggle(id)}
                >
                  ×
                </button>
              </span>
            )
          })}
        </div>
      )}

      <input
        type="search"
        className="admin-input admin-term-search"
        placeholder={`Search or add a ${noun}`}
        aria-label={`Search or add a ${noun}`}
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') return setQuery('')
          if (e.key !== 'Enter' && !(commitOnComma && e.key === ',')) return

          // This sits inside the post form. A bare Enter here would save the
          // post rather than add the term you were halfway through typing.
          e.preventDefault()
          commit()
        }}
      />

      {terms.length === 0 ? (
        <p className="admin-term-empty">{emptyText}</p>
      ) : matches.length === 0 ? (
        <p className="admin-term-empty">No matches for “{typed}”.</p>
      ) : (
        <div className="admin-term-list">
          {matches.map(term => (
            <label key={term.id} className="admin-term-option">
              <input
                type="checkbox"
                checked={selected.includes(term.id)}
                onChange={() => onToggle(term.id)}
              />
              <span>{term.name}</span>
            </label>
          ))}
        </div>
      )}

      {/* Under the list rather than under the field, so the list does not jump
          down a row on the first keystroke. It is where "+ Add New Category"
          always was; the difference is that it now knows what to call it. */}
      {typed && !exact && (
        <button
          type="button"
          className="admin-term-add"
          onClick={commit}
          disabled={busy}
        >
          + Add “{typed}”
        </button>
      )}
    </div>
  )
}
