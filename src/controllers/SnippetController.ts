import { can } from '@basicbenframework/core/auth/permissions'
// Extensions on these imports so the controller loads under plain Node too,
// which is how tests/phase2-api-editing.test.js exercises it.
import { Snippet, type SnippetRow } from '../models/Snippet.ts'
import type { Request, Response } from '../types/index.ts'

const NAME_MAX = 100
const CONTENT_MAX = 20_000

/**
 * Who may use snippets at all: authors and up.
 *
 * There is no snippet capability in the framework's role table, so this is
 * expressed through the nearest one that draws the same line — `post.publish`
 * is what an author has and a contributor does not. A contributor writes drafts
 * for someone else to review; a shared library of site-wide boilerplate (the
 * legal disclosure, the sign-off) is for the people who put posts live.
 */
export function mayUseSnippets(user: Request['user']): boolean {
  return can(user ?? null, 'post.publish')
}

/**
 * Who may change or delete this snippet: whoever wrote it, or an editor.
 *
 * `post.edit` (without `.own`) is the editor's "anyone's work" capability, so
 * it is the same rule as posts: authors look after their own, editors look
 * after everyone's.
 */
export function mayManageSnippet(user: Request['user'], snippet: Pick<SnippetRow, 'created_by'>): boolean {
  if (!mayUseSnippets(user)) return false
  if (can(user ?? null, 'post.edit')) return true
  return snippet.created_by !== null && String(snippet.created_by) === String(user?.id)
}

function present(snippet: SnippetRow, user: Request['user']) {
  return { ...snippet, can_edit: mayManageSnippet(user, snippet) }
}

/** Validate a body, for create (`partial` false) or update (`partial` true). */
function fieldsFrom(body: unknown, partial: boolean):
  | { values: { name?: string; content?: string } }
  | { errors: Record<string, string[]> } {
  const payload = (body ?? {}) as { name?: unknown; content?: unknown }
  const errors: Record<string, string[]> = {}
  const values: { name?: string; content?: string } = {}

  if (payload.name !== undefined || !partial) {
    const name = typeof payload.name === 'string' ? payload.name.trim() : ''
    if (!name) errors.name = ['A snippet needs a name']
    else if (name.length > NAME_MAX) errors.name = [`At most ${NAME_MAX} characters`]
    else values.name = name
  }

  if (payload.content !== undefined || !partial) {
    // Not trimmed: leading and trailing blank lines can be deliberate spacing
    // when the snippet lands in the middle of a post.
    const content = typeof payload.content === 'string' ? payload.content : ''
    if (!content.trim()) errors.content = ['A snippet needs some content']
    else if (content.length > CONTENT_MAX) errors.content = [`At most ${CONTENT_MAX} characters`]
    else values.content = content
  }

  return Object.keys(errors).length ? { errors } : { values }
}

export const SnippetController = {
  async index(req: Request, res: Response) {
    if (!mayUseSnippets(req.user)) return res.json({ error: 'Forbidden' }, 403)

    const search = typeof req.query?.search === 'string' ? req.query.search.trim().slice(0, 100) : ''
    const snippets = await Snippet.all(search || undefined)

    res.json({ snippets: snippets.map(snippet => present(snippet, req.user)) })
  },

  async show(req: Request, res: Response) {
    if (!mayUseSnippets(req.user)) return res.json({ error: 'Forbidden' }, 403)

    const snippet = await Snippet.find(parseInt(req.params.id))
    if (!snippet) return res.json({ error: 'Snippet not found' }, 404)

    res.json({ snippet: present(snippet, req.user) })
  },

  async store(req: Request, res: Response) {
    if (!mayUseSnippets(req.user)) return res.json({ error: 'Forbidden' }, 403)

    const fields = fieldsFrom(req.body, false)
    if ('errors' in fields) return res.json({ errors: fields.errors }, 422)

    const snippet = await Snippet.create({
      name: fields.values.name!,
      content: fields.values.content!,
      created_by: req.userId!
    })

    res.json({ snippet: snippet ? present(snippet, req.user) : null }, 201)
  },

  async update(req: Request, res: Response) {
    const snippet = await Snippet.find(parseInt(req.params.id))
    // Someone who cannot use snippets at all gets the same 403 as on the
    // listing; someone who can but did not write this one is told why.
    if (!mayUseSnippets(req.user)) return res.json({ error: 'Forbidden' }, 403)
    if (!snippet) return res.json({ error: 'Snippet not found' }, 404)
    if (!mayManageSnippet(req.user, snippet)) {
      return res.json({ error: 'Only its author or an editor can change this snippet.' }, 403)
    }

    const fields = fieldsFrom(req.body, true)
    if ('errors' in fields) return res.json({ errors: fields.errors }, 422)

    const updated = await Snippet.update(snippet.id, fields.values)
    res.json({ snippet: updated ? present(updated, req.user) : null })
  },

  async destroy(req: Request, res: Response) {
    const snippet = await Snippet.find(parseInt(req.params.id))
    if (!mayUseSnippets(req.user)) return res.json({ error: 'Forbidden' }, 403)
    if (!snippet) return res.json({ error: 'Snippet not found' }, 404)
    if (!mayManageSnippet(req.user, snippet)) {
      return res.json({ error: 'Only its author or an editor can delete this snippet.' }, 403)
    }

    // Deleting a snippet leaves every post that used it alone: the text was
    // copied in, not linked.
    await Snippet.delete(snippet.id)
    res.json({ deleted: true })
  }
}
