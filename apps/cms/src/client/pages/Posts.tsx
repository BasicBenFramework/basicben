import { useState, useEffect } from 'react'
import { useNavigate } from '@basicbenframework/core/client'
import { useTheme } from '../components/ThemeContext'
import { PageHeader } from '../components/PageHeader'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { Loading } from '../components/Loading'
import { Empty } from '../components/Empty'
import { api } from '../../helpers/api'
import { useToast } from '../contexts/ToastContext'
import type { Post } from '../../types'

interface PostsResponse {
  posts: Post[]
}

export function Posts() {
  const navigate = useNavigate()
  const { t } = useTheme()
  const toast = useToast()
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)

  const loadPosts = () => api<PostsResponse>('/api/posts').then(data => setPosts(data.posts)).finally(() => setLoading(false))

  useEffect(() => { loadPosts() }, [])

  const deletePost = async (id: number) => {
    if (!confirm('Delete this post?')) return
    try {
      await api(`/api/posts/${id}`, { method: 'DELETE' })
      toast.success('Post deleted')
      loadPosts()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  if (loading) return <Loading />

  return (
    <div>
      <PageHeader title="My Posts" action={<Button onClick={() => navigate('/posts/new')}>New Post</Button>} />
      {posts.length === 0 ? (
        <Empty>No posts yet. Create your first one!</Empty>
      ) : (
        <div className="space-y-3">
          {posts.map(post => (
            <Card key={post.id} className="flex items-center justify-between">
              <div className="flex-1 min-w-0 mr-4">
                <h2 className="font-medium truncate">{post.title}</h2>
                <p className={`text-xs ${t.muted}`}>{post.published ? 'Published' : 'Draft'} &bull; {new Date(post.created_at).toLocaleDateString()}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => navigate(`/posts/${post.id}/edit`)} className="text-xs px-3 py-1.5">Edit</Button>
                <Button variant="danger" onClick={() => deletePost(post.id)} className="text-xs px-3 py-1.5">Delete</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
