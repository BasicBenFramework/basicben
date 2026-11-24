/**
 * The reference theme's only templating primitive: escape by default.
 *
 * Templates are tagged template literals. Every interpolated value is escaped
 * unless it is already a `SafeHtml` — the result of another `html` template, or
 * of `raw()`. So the safe thing is what happens when you write the obvious
 * thing, and markup has to be asked for by name. `raw()` is used in exactly
 * two kinds of place: `content_html`, which the framework's sanitizer produced
 * at save time, and the admin's code injection, which is trusted by design
 * (see helpers/site-settings.ts).
 *
 * No dependencies and no DOM, so tests import this directly.
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;'
}

/** Escape text for an HTML text node or a quoted attribute value. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"'`]/g, (char) => ESCAPES[char])
}

/** Markup that is already safe to emit as-is. */
export class SafeHtml {
  // A plain field rather than a constructor parameter property: Node's type
  // stripping (how tests load this file) only erases syntax, never rewrites it.
  readonly value: string
  constructor(value: string) {
    this.value = value
  }
  toString(): string {
    return this.value
  }
}

/**
 * Mark a string as trusted markup. The name is the warning: only for HTML
 * that was sanitized on the way in, or that an administrator wrote on purpose.
 */
export function raw(value: string | null | undefined): SafeHtml {
  return new SafeHtml(value ?? '')
}

/**
 * Interpolations become text unless they are SafeHtml. Arrays are joined,
 * each item following the same rule, so `${items.map(item => html`…`)}` works.
 * `null`, `undefined` and `false` render nothing, so `${cond && html`…`}` does.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0]
  values.forEach((value, index) => {
    out += render(value) + strings[index + 1]
  })
  return new SafeHtml(out)
}

function render(value: unknown): string {
  if (value === null || value === undefined || value === false) return ''
  if (value instanceof SafeHtml) return value.value
  if (Array.isArray(value)) return value.map(render).join('')
  return escapeHtml(value)
}

/**
 * JSON for a `<script type="application/ld+json">` block.
 *
 * JSON.stringify does not escape `<`, so a title containing `</script>` would
 * end the block and the rest would be parsed as markup. Escaping `<`, `>` and
 * `&` as unicode escapes keeps it valid JSON and inert HTML; U+2028/2029 are
 * escaped because some parsers still treat them as line terminators.
 */
export function jsonForScript(value: unknown): SafeHtml {
  return raw(
    JSON.stringify(value)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(LINE_SEPARATORS, (char) => '\\u' + char.charCodeAt(0).toString(16))
  )
}

// Built from char codes: the raw characters in a source file are themselves
// line terminators to some tools.
const LINE_SEPARATORS = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']', 'g')

/**
 * An href a template may emit: http(s), mailto, or a root-relative path.
 * Anything else — `javascript:`, `data:` — becomes `#`. Defence in depth: the
 * values that reach templates were validated on save, but a theme should not
 * depend on every writer having been careful.
 */
export function safeHref(value: string | null | undefined): string {
  const url = String(value ?? '').trim()
  if (/^(https?:\/\/|mailto:)/i.test(url)) return url
  if (url.startsWith('/') && !url.startsWith('//')) return url
  return '#'
}
