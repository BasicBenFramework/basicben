/**
 * Content types — WordPress's custom post types — and their custom fields.
 *
 * Every entry of every type is a row in `posts`, told apart by
 * `posts.post_type`, so everything a post already has (status, scheduling,
 * revisions, locks, SEO, the editor) a recipe has for free. This module holds
 * what differs per type: its labels, where it lives on the public site, which
 * editor panels it supports, and the schema its custom fields are validated
 * against. See migrations 038 and 039.
 *
 * The validators at the top are pure and exported, so tests drive them without
 * a database. Imports carry `.ts` extensions so the module also loads under
 * plain Node, which is how tests/phase3-content-model.test.js exercises it.
 */

import { getDb, query } from '@basicbenframework/core/db'
import { isHttpUrl, isRelativePath, MAX_URL_LENGTH, normalizeRouteBase, POST_ROUTE_BASE } from '../helpers/content-paths.ts'

/** The kinds of custom field an editor can declare. */
export const FIELD_TYPES = ['text', 'textarea', 'number', 'url', 'date', 'boolean', 'select'] as const
export type FieldType = (typeof FIELD_TYPES)[number]

/** The editor panels and public behaviours a type can switch off. */
export const SUPPORTS = ['excerpt', 'featured_image', 'comments', 'categories', 'tags', 'custom_fields'] as const
export type Support = (typeof SUPPORTS)[number]

/**
 * Keys a custom type may not take. `post` is the built-in; the rest are words
 * the API already gives a meaning (`?type=any`) or WordPress reserves, which an
 * importer mapping WordPress types across would otherwise collide with.
 */
export const RESERVED_TYPE_KEYS = ['post', 'page', 'any', 'all', 'attachment', 'revision', 'nav_menu_item', 'media', 'comment']

/** Longest stored value per field type, so a field cannot become a second body. */
const TEXT_MAX = 1000
const TEXTAREA_MAX = 20_000
const MAX_FIELDS = 50
const MAX_OPTIONS = 100

export interface FieldDefinition {
  /** Machine name, the key in `fields`. Lowercase letters, digits, underscores. */
  key: string
  label: string
  type: FieldType
  /** Allowed values, for `select`. Empty for every other type. */
  options: string[]
  required: boolean
  help_text: string | null
}

/** A content type as the admin API and the content model read it. */
export interface ContentTypeRecord {
  id: number
  key: string
  singular_label: string
  plural_label: string
  description: string | null
  route_base: string
  public: boolean
  hierarchical: boolean
  builtin: boolean
  sort_order: number
  supports: Record<Support, boolean>
  fields: FieldDefinition[]
}

interface ContentTypeRow {
  id: number
  key: string
  singular_label: string
  plural_label: string
  description: string | null
  route_base: string
  is_public: number
  hierarchical: number
  builtin: number
  sort_order: number
  supports_excerpt: number
  supports_featured_image: number
  supports_comments: number
  supports_categories: number
  supports_tags: number
  supports_custom_fields: number
}

interface FieldRow {
  id: number
  content_type_id: number
  key: string
  label: string
  type: string
  options: string | null
  required: number
  help_text: string | null
  sort_order: number
}

type Errors = Record<string, string[]>

// --- Pure validation ---------------------------------------------------------

const truthy = (value: unknown) => value === true || value === 1 || value === '1' || value === 'true' || value === 'on'

function label(value: unknown, max = 100): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= max ? trimmed : null
}

/**
 * The type definition a create or update asks for.
 *
 * `existing` is null on create. On update absent keys keep their value, and the
 * built-in type keeps its key, route base and visibility whatever is sent: they
 * are what every URL the site has already published is made of.
 *
 * Uniqueness (key, route base) needs the database and is checked by the model.
 */
export function validateContentType(
  input: unknown,
  existing: ContentTypeRecord | null = null
): { values: Omit<ContentTypeRecord, 'id' | 'fields' | 'builtin'> & { fields?: FieldDefinition[] } } | { errors: Errors } {
  const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const errors: Errors = {}

  let key = existing?.key ?? ''
  if (!existing) {
    const raw = typeof body.key === 'string' ? body.key.trim().toLowerCase() : ''
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(raw)) {
      errors.key = ['Key must start with a letter and use lowercase letters, digits and underscores (32 at most)']
    } else if (RESERVED_TYPE_KEYS.includes(raw)) {
      errors.key = [`"${raw}" is reserved`]
    }
    key = raw
  } else if (body.key !== undefined && body.key !== existing.key) {
    // Renaming the key would orphan every post that carries the old one.
    errors.key = ['The key cannot be changed once a type exists']
  }

  const singular = 'singular_label' in body || !existing ? label(body.singular_label) : existing.singular_label
  const plural = 'plural_label' in body || !existing ? label(body.plural_label) : existing.plural_label
  if (!singular) errors.singular_label = ['Singular label is required (100 characters at most)']
  if (!plural) errors.plural_label = ['Plural label is required (100 characters at most)']

  let routeBase = existing?.route_base ?? ''
  if (existing?.builtin) {
    routeBase = POST_ROUTE_BASE
  } else if ('route_base' in body || !existing) {
    const requested = typeof body.route_base === 'string' && body.route_base.trim()
      ? body.route_base
      : key.replace(/_/g, '-')
    const normalized = normalizeRouteBase(requested)
    if (!normalized) {
      errors.route_base = ['Route base must be one path segment (letters, digits, hyphens) that the site does not already use']
    } else {
      routeBase = normalized
    }
  }

  const description = 'description' in body
    ? (typeof body.description === 'string' && body.description.trim() ? body.description.trim().slice(0, 1000) : null)
    : existing?.description ?? null

  const supports = {} as Record<Support, boolean>
  const requestedSupports = (body.supports && typeof body.supports === 'object' ? body.supports : {}) as Record<string, unknown>
  for (const name of SUPPORTS) {
    supports[name] = name in requestedSupports
      ? truthy(requestedSupports[name])
      : existing ? existing.supports[name] : true
  }

  const isPublic = existing?.builtin ? true : 'public' in body ? truthy(body.public) : existing?.public ?? true

  const sortOrder = 'sort_order' in body && Number.isInteger(Number(body.sort_order))
    ? Number(body.sort_order)
    : existing?.sort_order ?? 0

  let fields: FieldDefinition[] | undefined
  if ('fields' in body) {
    const checked = validateFieldDefinitions(body.fields)
    if ('errors' in checked) Object.assign(errors, checked.errors)
    else fields = checked.fields
  }

  if (Object.keys(errors).length) return { errors }

  return {
    values: {
      key,
      singular_label: singular!,
      plural_label: plural!,
      description,
      route_base: routeBase,
      public: isPublic,
      // Stored for when hierarchy arrives; nothing reads it yet, so it is
      // refused rather than silently accepted and ignored.
      hierarchical: false,
      sort_order: sortOrder,
      supports,
      ...(fields ? { fields } : {})
    }
  }
}

/** A type's field list, as the admin's fields editor sends it. */
export function validateFieldDefinitions(input: unknown): { fields: FieldDefinition[] } | { errors: Errors } {
  if (!Array.isArray(input)) return { errors: { fields: ['Fields must be a list'] } }
  if (input.length > MAX_FIELDS) return { errors: { fields: [`At most ${MAX_FIELDS} fields per type`] } }

  const errors: Errors = {}
  const fields: FieldDefinition[] = []
  const seen = new Set<string>()

  input.forEach((raw, index) => {
    const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const at = `fields.${index}`
    const key = typeof item.key === 'string' ? item.key.trim().toLowerCase() : ''

    if (!/^[a-z][a-z0-9_]{0,49}$/.test(key)) {
      errors[`${at}.key`] = ['Field key must start with a letter and use lowercase letters, digits and underscores']
      return
    }
    if (seen.has(key)) {
      errors[`${at}.key`] = [`Duplicate field key "${key}"`]
      return
    }
    seen.add(key)

    const fieldLabel = label(item.label) ?? null
    if (!fieldLabel) errors[`${at}.label`] = ['Label is required']

    const type = (FIELD_TYPES as readonly string[]).includes(String(item.type)) ? (item.type as FieldType) : null
    if (!type) errors[`${at}.type`] = [`Type must be one of ${FIELD_TYPES.join(', ')}`]

    let options: string[] = []
    if (type === 'select') {
      const list = Array.isArray(item.options)
        ? item.options
        : typeof item.options === 'string' ? item.options.split('\n') : []
      options = [...new Set(list.map((option) => String(option).trim()).filter(Boolean))]
      if (options.length === 0) errors[`${at}.options`] = ['A select field needs at least one option']
      if (options.length > MAX_OPTIONS) errors[`${at}.options`] = [`At most ${MAX_OPTIONS} options`]
      if (options.some((option) => option.length > 200)) errors[`${at}.options`] = ['Options are 200 characters at most']
    }

    const help = typeof item.help_text === 'string' && item.help_text.trim() ? item.help_text.trim().slice(0, 500) : null

    if (fieldLabel && type) {
      fields.push({ key, label: fieldLabel, type, options, required: truthy(item.required), help_text: help })
    }
  })

  return Object.keys(errors).length ? { errors } : { fields }
}

/**
 * A post's custom field values, checked against its type's schema.
 *
 * Each value is coerced to its field's type and stored in that form — a number
 * as a number, a date as `YYYY-MM-DD`, a boolean as a boolean — so a consumer
 * never has to guess whether `"3"` is three. Blank values are left out rather
 * than stored as empty strings, which is also what "not filled in" means to a
 * required check.
 *
 * Keys the schema does not declare are dropped, not refused: a field removed
 * from a type should not make every post that still carries a value for it
 * unsaveable. Only declared, valid values are ever stored.
 */
export function validateFieldValues(
  definitions: FieldDefinition[],
  input: unknown
): { values: Record<string, unknown> } | { errors: Errors } {
  const body = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>
  const values: Record<string, unknown> = {}
  const errors: Errors = {}

  for (const field of definitions) {
    const raw = body[field.key]
    const blank = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')

    // A boolean is never blank in the way text is: unchecked is `false`, and
    // `false` is an answer. Required on a boolean therefore means "present".
    if (field.type === 'boolean') {
      if (raw === undefined || raw === null || raw === '') {
        if (field.required) errors[`fields.${field.key}`] = [`${field.label} is required`]
        continue
      }
      values[field.key] = truthy(raw)
      continue
    }

    if (blank) {
      if (field.required) errors[`fields.${field.key}`] = [`${field.label} is required`]
      continue
    }

    const result = coerce(field, raw)
    if ('error' in result) errors[`fields.${field.key}`] = [result.error]
    else values[field.key] = result.value
  }

  return Object.keys(errors).length ? { errors } : { values }
}

function coerce(field: FieldDefinition, raw: unknown): { value: unknown } | { error: string } {
  const text = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : null

  switch (field.type) {
    case 'text':
      if (text === null) return { error: `${field.label} must be text` }
      if (/[\r\n]/.test(text)) return { error: `${field.label} must be a single line` }
      return text.length <= TEXT_MAX ? { value: text } : { error: `${field.label} is ${TEXT_MAX} characters at most` }
    case 'textarea':
      if (text === null) return { error: `${field.label} must be text` }
      return text.length <= TEXTAREA_MAX ? { value: text } : { error: `${field.label} is ${TEXTAREA_MAX} characters at most` }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(text)
      return text !== null && text !== '' && Number.isFinite(n) ? { value: n } : { error: `${field.label} must be a number` }
    }
    case 'url':
      // The same allowlist a menu link gets: these are rendered into `href` by
      // a theme, and a `javascript:` value there is stored XSS.
      if (text === null || text.length > MAX_URL_LENGTH || (!isHttpUrl(text) && !isRelativePath(text))) {
        return { error: `${field.label} must be an http(s) URL or a path starting with /` }
      }
      return { value: text }
    case 'date': {
      // Stored as a calendar date. A datetime would carry a time zone, and
      // "the event is on the 3rd" is not a moment.
      const match = text?.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/)
      if (!match) return { error: `${field.label} must be a date (YYYY-MM-DD)` }
      const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`)
      if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== `${match[1]}-${match[2]}-${match[3]}`) {
        return { error: `${field.label} must be a real date` }
      }
      return { value: `${match[1]}-${match[2]}-${match[3]}` }
    }
    case 'select':
      return text !== null && field.options.includes(text)
        ? { value: text }
        : { error: `${field.label} must be one of ${field.options.join(', ')}` }
    default:
      return { error: `${field.label} has an unknown type` }
  }
}

/** The `fields` column as an object. Corrupt or absent JSON reads as empty. */
export function parseStoredFields(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string' || !value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Stored values, restricted to what the type declares now.
 *
 * What a public read returns. A value left behind by a field that has since
 * been deleted is not part of the type any more and should not keep being
 * published.
 */
export function publicFieldValues(definitions: FieldDefinition[], stored: unknown): Record<string, unknown> {
  const values = parseStoredFields(stored)
  const out: Record<string, unknown> = {}
  for (const field of definitions) {
    if (field.key in values) out[field.key] = values[field.key]
  }
  return out
}

// --- Rows to records ---------------------------------------------------------

function shapeField(row: FieldRow): FieldDefinition {
  let options: string[] = []
  try {
    const parsed = row.options ? JSON.parse(row.options) : []
    options = Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    options = []
  }

  return {
    key: row.key,
    label: row.label,
    type: (FIELD_TYPES as readonly string[]).includes(row.type) ? (row.type as FieldType) : 'text',
    options,
    required: Boolean(Number(row.required)),
    help_text: row.help_text
  }
}

function shapeType(row: ContentTypeRow, fields: FieldDefinition[]): ContentTypeRecord {
  return {
    id: Number(row.id),
    key: row.key,
    singular_label: row.singular_label,
    plural_label: row.plural_label,
    description: row.description,
    route_base: row.route_base,
    public: Boolean(Number(row.is_public)),
    hierarchical: Boolean(Number(row.hierarchical)),
    builtin: Boolean(Number(row.builtin)),
    sort_order: Number(row.sort_order) || 0,
    supports: {
      excerpt: Boolean(Number(row.supports_excerpt)),
      featured_image: Boolean(Number(row.supports_featured_image)),
      comments: Boolean(Number(row.supports_comments)),
      categories: Boolean(Number(row.supports_categories)),
      tags: Boolean(Number(row.supports_tags)),
      custom_fields: Boolean(Number(row.supports_custom_fields))
    },
    fields
  }
}

function columnsFor(values: Omit<ContentTypeRecord, 'id' | 'fields' | 'builtin'>): Record<string, unknown> {
  return {
    key: values.key,
    singular_label: values.singular_label,
    plural_label: values.plural_label,
    description: values.description,
    route_base: values.route_base,
    is_public: values.public ? 1 : 0,
    hierarchical: values.hierarchical ? 1 : 0,
    sort_order: values.sort_order,
    supports_excerpt: values.supports.excerpt ? 1 : 0,
    supports_featured_image: values.supports.featured_image ? 1 : 0,
    supports_comments: values.supports.comments ? 1 : 0,
    supports_categories: values.supports.categories ? 1 : 0,
    supports_tags: values.supports.tags ? 1 : 0,
    supports_custom_fields: values.supports.custom_fields ? 1 : 0
  }
}

// --- Database ----------------------------------------------------------------

/**
 * Every type with its fields, in two queries however many types there are.
 *
 * Content types are a handful of rows read on most requests that touch a post,
 * so this is the one read everything else builds on; it is not cached in
 * memory because a serverless instance has no way to hear that an admin
 * changed one on another instance.
 */
async function loadAll(): Promise<ContentTypeRecord[]> {
  const db = await getDb()
  const rows = (await db.all('SELECT * FROM content_types ORDER BY sort_order ASC, id ASC')) as ContentTypeRow[]
  const fieldRows = (await db.all(
    'SELECT * FROM content_type_fields ORDER BY sort_order ASC, id ASC'
  )) as FieldRow[]

  const byType = new Map<number, FieldDefinition[]>()
  for (const row of fieldRows) {
    const list = byType.get(Number(row.content_type_id)) ?? []
    list.push(shapeField(row))
    byType.set(Number(row.content_type_id), list)
  }

  return rows.map((row) => shapeType(row, byType.get(Number(row.id)) ?? []))
}

export const ContentType = {
  async all(options: { publicOnly?: boolean } = {}): Promise<ContentTypeRecord[]> {
    const types = await loadAll()
    return options.publicOnly ? types.filter((type) => type.public) : types
  },

  async find(id: number): Promise<ContentTypeRecord | undefined> {
    return (await loadAll()).find((type) => type.id === id)
  },

  async findByKey(key: string): Promise<ContentTypeRecord | undefined> {
    return (await loadAll()).find((type) => type.key === key)
  },

  /** Which type owns a route base, for the theme's `/:base/:slug`. */
  async findByRouteBase(routeBase: string): Promise<ContentTypeRecord | undefined> {
    return (await loadAll()).find((type) => type.route_base === routeBase)
  },

  /** Posts of a type, trashed ones included — a type with any cannot be deleted. */
  async postCount(key: string): Promise<number> {
    const db = await getDb()
    const row = await db.get('SELECT COUNT(*) AS total FROM posts WHERE post_type = ?', [key])
    return Number(row?.total) || 0
  },

  /** Is this key or route base taken by a type other than `excludeId`? */
  async clashes(values: { key: string; route_base: string }, excludeId?: number): Promise<Errors> {
    const types = await loadAll()
    const errors: Errors = {}
    const others = types.filter((type) => type.id !== excludeId)

    if (others.some((type) => type.key === values.key)) errors.key = ['A content type with this key already exists']
    if (others.some((type) => type.route_base === values.route_base)) errors.route_base = ['Another content type already lives at this route base']

    return errors
  },

  async create(values: Omit<ContentTypeRecord, 'id' | 'fields' | 'builtin'> & { fields?: FieldDefinition[] }): Promise<ContentTypeRecord> {
    // Through the query builder, which appends RETURNING id on Postgres.
    const result = await (await query('content_types')).insert({ ...columnsFor(values), builtin: 0 })
    const id = Number(result.lastInsertRowid)

    if (values.fields) await this.replaceFields(id, values.fields)

    return (await this.find(id))!
  },

  async update(id: number, values: Omit<ContentTypeRecord, 'id' | 'fields' | 'builtin'> & { fields?: FieldDefinition[] }): Promise<ContentTypeRecord> {
    const db = await getDb()
    const columns = columnsFor(values)
    const keys = Object.keys(columns)

    await db.run(
      `UPDATE content_types SET ${keys.map((key) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
      [...keys.map((key) => columns[key]), new Date().toISOString(), id]
    )

    if (values.fields) await this.replaceFields(id, values.fields)

    return (await this.find(id))!
  },

  /**
   * Replace a type's field list.
   *
   * Rebuilt rather than diffed, for the same reason categories are: the editor
   * sends the whole list, and a merge would make removing a field do nothing.
   * Stored values on posts are left alone — `publicFieldValues` stops a removed
   * field being published, and re-adding it brings the values back.
   */
  async replaceFields(typeId: number, fields: FieldDefinition[]): Promise<void> {
    const db = await getDb()
    await db.run('DELETE FROM content_type_fields WHERE content_type_id = ?', [typeId])

    for (const [index, field] of fields.entries()) {
      await db.run(
        `INSERT INTO content_type_fields (content_type_id, key, label, type, options, required, help_text, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [typeId, field.key, field.label, field.type, field.options.length ? JSON.stringify(field.options) : null,
          field.required ? 1 : 0, field.help_text, index]
      )
    }
  },

  async delete(id: number): Promise<void> {
    const db = await getDb()
    await db.run('DELETE FROM content_type_fields WHERE content_type_id = ?', [id])
    await db.run('DELETE FROM taxonomy_content_types WHERE content_type_id = ?', [id])
    await db.run('DELETE FROM content_types WHERE id = ? AND builtin = 0', [id])
  }
}

/**
 * A type's route base, or null when the type is unknown.
 *
 * Exported on its own because the redirect helper needs exactly this and
 * nothing else about the type.
 */
export async function routeBaseFor(key: string): Promise<string | null> {
  if (key === 'post') return POST_ROUTE_BASE
  const db = await getDb()
  const row = await db.get('SELECT route_base FROM content_types WHERE key = ?', [key])
  return row?.route_base ?? null
}
