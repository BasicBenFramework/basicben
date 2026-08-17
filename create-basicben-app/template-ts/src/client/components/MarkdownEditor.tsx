import React, { useMemo, useRef, useState } from 'react'
import { renderContentSync } from '@basicbenframework/core/content'
import MediaPicker, { markdownFor } from './admin/MediaPicker'

/**
 * Markdown editor with a live preview.
 *
 * ## Why a textarea and not CodeMirror
 *
 * CodeMirror 6 would add syntax highlighting, and about a dozen packages to a
 * framework whose whole premise is that it adds none. What an author actually
 * needs from an editor is to see what they are about to publish, and that comes
 * from the preview rather than from coloured asterisks in the source pane.
 *
 * A block editor like TipTap was the other candidate and is the wrong shape
 * here: it wants to own the document model, which puts it at odds with Markdown
 * being the source of truth. A blog should outlive the CMS that published it,
 * and that only works if what is stored is the Markdown.
 *
 * ## The preview is the same renderer
 *
 * It calls `renderContentSync`, which is the server's pipeline minus the plugin
 * filter — parse, then sanitize, same code. A preview that renders through a
 * different path is not a preview, it is a second opinion.
 */

interface MarkdownEditorProps {
  name: string
  value: string
  /** Takes the same handler a plain <textarea> would, so it drops into an existing form. */
  onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  minHeight?: string
  required?: boolean
}

type Mode = 'write' | 'preview'

/** A toolbar button: what it inserts and how it treats the selection. */
interface Mark {
  label: string
  title: string
  before: string
  after?: string
  /** Applied to each selected line rather than around the selection. */
  linePrefix?: string
  placeholder?: string
}

const MARKS: Mark[] = [
  { label: 'B', title: 'Bold (⌘B)', before: '**', after: '**', placeholder: 'bold text' },
  { label: 'I', title: 'Italic (⌘I)', before: '_', after: '_', placeholder: 'italic text' },
  { label: 'S', title: 'Strikethrough', before: '~~', after: '~~', placeholder: 'struck out' },
  { label: '<>', title: 'Code', before: '`', after: '`', placeholder: 'code' },
  { label: 'H', title: 'Heading', before: '', linePrefix: '## ', placeholder: 'Heading' },
  { label: '"', title: 'Quote', before: '', linePrefix: '> ', placeholder: 'Quoted' },
  { label: '•', title: 'Bulleted list', before: '', linePrefix: '- ', placeholder: 'Item' },
  { label: '1.', title: 'Numbered list', before: '', linePrefix: '1. ', placeholder: 'Item' },
  { label: '🔗', title: 'Link (⌘K)', before: '[', after: '](https://)', placeholder: 'link text' }
]

export default function MarkdownEditor({
  name,
  value,
  onChange,
  placeholder,
  minHeight = '400px',
  required
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<Mode>('write')
  const [picking, setPicking] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Rendering on every keystroke is wasteful but not slow — a long post takes a
  // couple of milliseconds — and useMemo keeps it off the path when the source
  // has not changed, such as when switching tabs.
  const preview = useMemo(() => {
    try {
      return renderContentSync(value || '')
    } catch (error) {
      return `<p style="color:#b91c1c">Preview failed: ${(error as Error).message}</p>`
    }
  }, [value])

  /**
   * Report a toolbar edit through the same handler a keystroke uses.
   *
   * Toolbar clicks change the value without the browser producing an event, so
   * one is fabricated. Only the fields a form handler reads are supplied, hence
   * the cast — building a whole synthetic React event would add nothing a
   * caller could use.
   */
  const emit = (next: string) => {
    onChange({
      target: { name, value: next, type: 'textarea' }
    } as unknown as React.ChangeEvent<HTMLTextAreaElement>)
  }

  const applyMark = (mark: Mark) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = value.slice(start, end)

    let next: string
    let cursorStart: number
    let cursorEnd: number

    if (mark.linePrefix) {
      // Line marks apply to whole lines, so the selection is widened to line
      // boundaries first — otherwise selecting mid-sentence inserts a '> ' into
      // the middle of it.
      const lineStart = value.lastIndexOf('\n', start - 1) + 1
      const lineEnd = value.indexOf('\n', end) === -1 ? value.length : value.indexOf('\n', end)
      const block = value.slice(lineStart, lineEnd) || mark.placeholder || ''

      const already = block.split('\n').every((line) => line.startsWith(mark.linePrefix!))
      const marked = block
        .split('\n')
        .map((line) => (already ? line.slice(mark.linePrefix!.length) : mark.linePrefix + line))
        .join('\n')

      next = value.slice(0, lineStart) + marked + value.slice(lineEnd)
      cursorStart = lineStart
      cursorEnd = lineStart + marked.length
    } else {
      const body = selected || mark.placeholder || ''
      const after = mark.after ?? ''

      // Toggle off when the mark is already there, so clicking B twice undoes it
      // rather than producing ****text****.
      const wrapped =
        selected &&
        value.slice(start - mark.before.length, start) === mark.before &&
        value.slice(end, end + after.length) === after

      if (wrapped) {
        next = value.slice(0, start - mark.before.length) + selected + value.slice(end + after.length)
        cursorStart = start - mark.before.length
        cursorEnd = cursorStart + selected.length
      } else {
        next = value.slice(0, start) + mark.before + body + after + value.slice(end)
        cursorStart = start + mark.before.length
        cursorEnd = cursorStart + body.length
      }
    }

    emit(next)

    // The value lands via React state, so the selection has to be restored
    // after the re-render or the caret jumps to the end.
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(cursorStart, cursorEnd)
    })
  }

  /**
   * Drop text in at the caret, replacing any selection.
   *
   * Used by the media picker, which produces a finished piece of Markdown
   * rather than wrapping what is already there the way the toolbar marks do.
   */
  const insertAtCursor = (text: string) => {
    const textarea = textareaRef.current
    const start = textarea ? textarea.selectionStart : value.length
    const end = textarea ? textarea.selectionEnd : value.length

    emit(value.slice(0, start) + text + value.slice(end))

    requestAnimationFrame(() => {
      textarea?.focus()
      textarea?.setSelectionRange(start + text.length, start + text.length)
    })
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Tab') {
      // Tab indents rather than leaving the field: inside a Markdown editor a
      // tab almost always means "nest this list item".
      event.preventDefault()
      const textarea = event.currentTarget
      const start = textarea.selectionStart
      const next = `${value.slice(0, start)}  ${value.slice(textarea.selectionEnd)}`
      emit(next)
      requestAnimationFrame(() => textarea.setSelectionRange(start + 2, start + 2))
      return
    }

    if (!event.metaKey && !event.ctrlKey) return

    const shortcuts: Record<string, string> = { b: 'Bold (⌘B)', i: 'Italic (⌘I)', k: 'Link (⌘K)' }
    const title = shortcuts[event.key.toLowerCase()]
    if (!title) return

    const mark = MARKS.find((m) => m.title === title)
    if (!mark) return

    event.preventDefault()
    applyMark(mark)
  }

  return (
    <div className="markdown-editor">
      <div
        className="markdown-editor-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.25rem',
          flexWrap: 'wrap',
          padding: '0.375rem',
          border: '1px solid #d1d5db',
          borderBottom: 'none',
          borderRadius: '0.375rem 0.375rem 0 0',
          backgroundColor: '#f9fafb'
        }}
      >
        {MARKS.map((mark) => (
          <button
            key={mark.title}
            type="button"
            title={mark.title}
            onClick={() => applyMark(mark)}
            disabled={mode === 'preview'}
            style={{
              minWidth: '2rem',
              padding: '0.25rem 0.5rem',
              border: '1px solid transparent',
              borderRadius: '0.25rem',
              backgroundColor: 'transparent',
              cursor: mode === 'preview' ? 'default' : 'pointer',
              opacity: mode === 'preview' ? 0.4 : 1,
              fontWeight: mark.label === 'B' ? 700 : 400,
              fontStyle: mark.label === 'I' ? 'italic' : 'normal',
              textDecoration: mark.label === 'S' ? 'line-through' : 'none',
              fontSize: '0.875rem'
            }}
          >
            {mark.label}
          </button>
        ))}

        <button
          type="button"
          title="Insert media"
          onClick={() => setPicking(true)}
          disabled={mode === 'preview'}
          style={{
            minWidth: '2rem',
            padding: '0.25rem 0.5rem',
            border: '1px solid transparent',
            borderRadius: '0.25rem',
            backgroundColor: 'transparent',
            cursor: mode === 'preview' ? 'default' : 'pointer',
            opacity: mode === 'preview' ? 0.4 : 1,
            fontSize: '0.875rem'
          }}
        >
          🖼
        </button>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem' }}>
          {(['write', 'preview'] as Mode[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setMode(tab)}
              style={{
                padding: '0.25rem 0.75rem',
                border: '1px solid #d1d5db',
                borderRadius: '0.25rem',
                backgroundColor: mode === tab ? '#ffffff' : 'transparent',
                fontWeight: mode === tab ? 600 : 400,
                cursor: 'pointer',
                fontSize: '0.875rem',
                textTransform: 'capitalize'
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {mode === 'write' ? (
        <textarea
          ref={textareaRef}
          name={name}
          value={value}
          onChange={onChange}
          onKeyDown={handleKeyDown}
          className="admin-textarea"
          style={{
            minHeight,
            borderRadius: '0 0 0.375rem 0.375rem',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: '0.875rem',
            lineHeight: 1.6
          }}
          placeholder={placeholder}
          required={required}
        />
      ) : (
        <div
          className="markdown-editor-preview"
          style={{
            minHeight,
            padding: '0.75rem',
            border: '1px solid #d1d5db',
            borderRadius: '0 0 0.375rem 0.375rem',
            backgroundColor: '#ffffff',
            overflowWrap: 'break-word'
          }}
          // The HTML here came from renderContentSync, which sanitizes against
          // the same allowlist the server uses before storing anything.
          dangerouslySetInnerHTML={{ __html: preview || '<p style="color:#9ca3af">Nothing to preview yet.</p>' }}
        />
      )}

      <p style={{ margin: '0.375rem 0 0', color: '#6b7280', fontSize: '0.8125rem' }}>
        Markdown supported — headings, lists, links, tables, and fenced code.
        HTML is shown as text rather than rendered.
      </p>

      {picking && (
        <MediaPicker
          onClose={() => setPicking(false)}
          onSelect={(item) => {
            insertAtCursor(markdownFor(item))
            setPicking(false)
          }}
        />
      )}
    </div>
  )
}
