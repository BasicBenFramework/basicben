import { useState, useEffect, FormEvent, ChangeEvent } from 'react'
import { useNavigate, useParams } from '@basicbenframework/core/client'
import { PageHeader } from '../components/PageHeader'
import { BackLink } from '../components/BackLink'
import { Input } from '../components/Input'
import { Textarea } from '../components/Textarea'
import { Button } from '../components/Button'
import { Loading } from '../components/Loading'
import { api } from '../../helpers/api'
import { useToast } from '../contexts/ToastContext'
import type { Post } from '../../types'

interface PostResponse {
  post: Post
}

export function PostForm() {
  const navigate = useNavigate()
  const params = useParams()
  const postId = params.id
  const toast = useToast()
  const [form, setForm] = useState({ title: '', content: '', published: false })
  const [loading, setLoading] = useState(!!postId)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (postId) {
      api<PostResponse>(`/api/posts/${postId}`)
        .then(data => setForm({ title: data.post.title, content: data.post.content, published: !!data.post.published }))
        .catch(err => {
          toast.error((err as Error).message)
          navigate('/posts')
        })
        .finally(() => setLoading(false))
    }
  }, [postId])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (postId) {
        await api(`/api/posts/${postId}`, { method: 'PUT', body: JSON.stringify(form) })
        toast.success('Post updated')
      } else {
        await api('/api/posts', { method: 'POST', body: JSON.stringify(form) })
        toast.success('Post created')
      }
      navigate('/posts')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Loading />

  return (
    <div className="max-w-xl mx-auto">
      <BackLink onClick={() => navigate('/posts')}>Back to posts</BackLink>
      <PageHeader title={postId ? 'Edit Post' : 'New Post'} />
      <form onSubmit={handleSubmit} className="space-y-4 mt-4">
        <Input placeholder="Title" required value={form.title} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, title: e.target.value })} />
        <Textarea placeholder="Write your post content..." required rows={10} value={form.content} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, content: e.target.value })} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.published} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, published: e.target.checked })} className="rounded" />
          Publish this post
        </label>
        <Button type="submit" disabled={saving} className="w-full">{saving ? '...' : postId ? 'Update Post' : 'Create Post'}</Button>
      </form>
    </div>
  )
}
