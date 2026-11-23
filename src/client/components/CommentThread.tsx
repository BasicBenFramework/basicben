import { useState, useEffect, FormEvent } from 'react'
import { useAuth } from '@basicbenframework/core/client'
import { useTheme } from './ThemeContext'
import { Card } from './Card'
import { Avatar } from './Avatar'
import { Button } from './Button'
import { Input } from './Input'
import { Textarea } from './Textarea'
import { Alert } from './Alert'
import { api } from '../../helpers/api'

/** A comment as the public list returns it: no addresses, ever. */
interface PublicComment {
  id: number
  parent_id: number | null
  author_name: string | null
  content: string
  created_at: string
  verified: number | boolean
  depth?: number
  replies?: PublicComment[]
}

/** What the comment form posts back, from the list response. */
interface FormInfo {
  open: boolean
  token: string
  honeypot: string
  max_depth: number
}

interface CommentsResponse {
  comments: PublicComment[]
  form?: FormInfo
}

function countAll(comments: PublicComment[]): number {
  return comments.reduce((n, c) => n + 1 + countAll(c.replies ?? []), 0)
}

/**
 * The comments under a post: the approved thread, and a form to join it.
 *
 * Threaded to the depth the server allows (`form.max_depth`); the Reply
 * button simply stops appearing at the last level rather than letting a
 * reader write something the server will refuse.
 *
 * The form carries two things a person never notices. A signed timestamp
 * from the list response, which tells the server how long the form was open —
 * a bot posts back in milliseconds. And a honeypot field, kept off-screen and
 * out of the tab order, that only a form-filling bot ever completes.
 */
export function CommentThread({ postId }: { postId: number | string }) {
  const { t } = useTheme()
  const [comments, setComments] = useState<PublicComment[]>([])
  const [form, setForm] = useState<FormInfo | null>(null)
  const [replyTo, setReplyTo] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = () =>
    api<CommentsResponse>(`/api/posts/${postId}/comments`)
      .then(data => {
        setComments(data.comments ?? [])
        setForm(data.form ?? null)
      })
      .catch(() => setComments([]))

  useEffect(() => { load() }, [postId])

  // Arriving from a notification email's #comment-123 link: the comments
  // load after the page, so the browser's own jump to the anchor has already
  // happened and found nothing.
  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash : ''
    if (hash.startsWith('#comment-')) document.getElementById(hash.slice(1))?.scrollIntoView()
  }, [comments])

  const posted = (message: string) => {
    setNotice(message)
    setReplyTo(null)
    // Reloaded either way: an approved comment appears, and the form gets a
    // fresh token for the next one.
    load()
  }

  const total = countAll(comments)

  return (
    <Card className="p-6 mt-4">
      <h2 className="text-lg font-semibold mb-4">
        {total === 0 ? 'Comments' : `${total} comment${total === 1 ? '' : 's'}`}
      </h2>

      {notice && <div className="mb-4"><Alert type="success">{notice}</Alert></div>}

      {comments.length === 0 && (
        <p className={`text-sm ${t.muted} mb-4`}>No comments yet.</p>
      )}

      <ol className="space-y-4 mb-6">
        {comments.map(comment => (
          <CommentItem
            key={comment.id}
            comment={comment}
            depth={1}
            form={form}
            postId={postId}
            replyTo={replyTo}
            onReply={setReplyTo}
            onPosted={posted}
          />
        ))}
      </ol>

      {form?.open
        ? replyTo === null && <CommentForm postId={postId} form={form} onPosted={posted} />
        : form && <p className={`text-sm ${t.muted}`}>Comments are closed.</p>}
    </Card>
  )
}

interface ItemProps {
  comment: PublicComment
  depth: number
  form: FormInfo | null
  postId: number | string
  replyTo: number | null
  onReply: (id: number | null) => void
  onPosted: (message: string) => void
}

function CommentItem({ comment, depth, form, postId, replyTo, onReply, onPosted }: ItemProps) {
  const { t } = useTheme()
  const name = comment.author_name || 'Anonymous'
  const canReply = !!form?.open && depth < (form?.max_depth ?? 1)

  return (
    <li id={`comment-${comment.id}`}>
      <div className="flex gap-3">
        <Avatar name={name} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <span className="font-medium">{name}</span>
            {/* From an account, not typed into a guest form — so a guest
                using an editor's name is not taken for the editor. */}
            {Boolean(comment.verified) && <span className={`${t.muted} text-xs`}> &bull; member</span>}
            <span className={`${t.muted} text-xs`}> &bull; {new Date(comment.created_at).toLocaleDateString()}</span>
          </p>
          <p className="text-sm whitespace-pre-wrap break-words mt-1">{comment.content}</p>
          {canReply && (
            <button
              type="button"
              className={`text-xs ${t.muted} hover:opacity-70 mt-1`}
              onClick={() => onReply(replyTo === comment.id ? null : comment.id)}
            >
              {replyTo === comment.id ? 'Cancel reply' : 'Reply'}
            </button>
          )}
          {replyTo === comment.id && form && (
            <div className="mt-3">
              <CommentForm postId={postId} form={form} parentId={comment.id} parentName={name} onPosted={onPosted} />
            </div>
          )}
        </div>
      </div>

      {/* Indented by a border rather than a growing margin, so the third
          level still has room on a phone. */}
      {comment.replies && comment.replies.length > 0 && (
        <ol className={`mt-4 space-y-4 pl-4 border-l ${t.border}`}>
          {comment.replies.map(reply => (
            <CommentItem
              key={reply.id}
              comment={reply}
              depth={depth + 1}
              form={form}
              postId={postId}
              replyTo={replyTo}
              onReply={onReply}
              onPosted={onPosted}
            />
          ))}
        </ol>
      )}
    </li>
  )
}

interface FormProps {
  postId: number | string
  form: FormInfo
  parentId?: number
  parentName?: string
  onPosted: (message: string) => void
}

function CommentForm({ postId, form, parentId, parentName, onPosted }: FormProps) {
  const { t } = useTheme()
  const { user } = useAuth()
  const [content, setContent] = useState('')
  const [authorName, setAuthorName] = useState('')
  const [authorEmail, setAuthorEmail] = useState('')
  const [notify, setNotify] = useState(false)
  const [trap, setTrap] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSending(true)
    try {
      const res = await api.post<{ message?: string }>(`/api/posts/${postId}/comments`, {
        content,
        ...(user ? {} : { author_name: authorName, author_email: authorEmail }),
        parent_id: parentId,
        notify_replies: notify,
        form_token: form.token,
        [form.honeypot]: trap
      })
      setContent('')
      onPosted(res?.message || 'Comment posted.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSending(false)
    }
  }

  const id = `comment-form-${parentId ?? 'new'}`

  return (
    <form onSubmit={submit} className="space-y-3">
      <label htmlFor={`${id}-content`} className="text-sm font-medium block">
        {parentId ? `Reply to ${parentName}` : 'Leave a comment'}
      </label>
      <Textarea
        id={`${id}-content`}
        rows={parentId ? 3 : 4}
        value={content}
        onChange={e => setContent(e.target.value)}
        required
        minLength={3}
        maxLength={2000}
      />

      {!user && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input aria-label="Name" placeholder="Name" value={authorName} onChange={e => setAuthorName(e.target.value)} required minLength={2} maxLength={100} />
          <Input aria-label="Email" placeholder="Email (never shown)" type="email" value={authorEmail} onChange={e => setAuthorEmail(e.target.value)} required />
        </div>
      )}

      {/* The honeypot. Off-screen rather than display:none, which some bots
          check for; hidden from screen readers and the tab order so no person
          can land in it. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
        <label>
          Leave this empty
          <input type="text" name={form.honeypot} tabIndex={-1} autoComplete="off" value={trap} onChange={e => setTrap(e.target.value)} />
        </label>
      </div>

      <label className={`flex items-center gap-2 text-sm ${t.muted}`}>
        <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} />
        Email me when someone replies
      </label>

      {error && <Alert>{error}</Alert>}

      <Button type="submit" disabled={sending}>
        {sending ? 'Sending…' : parentId ? 'Post reply' : 'Post comment'}
      </Button>
    </form>
  )
}
