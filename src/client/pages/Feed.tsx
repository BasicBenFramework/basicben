import { useState, useEffect } from 'react'
import { useNavigate } from '@basicbenframework/core/client'
import { PageHeader } from '../components/PageHeader.tsx'
import { PostCard } from '../components/PostCard.tsx'
import { Loading } from '../components/Loading.tsx'
import { Empty } from '../components/Empty.tsx'
import { api } from '../../helpers/api.ts'
import type { Post } from '../../types/index.ts'

interface FeedResponse {
  posts: Post[]
}

export function Feed() {
  const navigate = useNavigate()
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api<FeedResponse>('/api/feed').then(data => setPosts(data.posts)).finally(() => setLoading(false))
  }, [])

  if (loading) return <Loading />

  return (
    <div>
      <PageHeader title="Feed" />
      {posts.length === 0 ? (
        <Empty>No posts yet</Empty>
      ) : (
        <div className="space-y-4">
          {posts.map(post => (
            <PostCard key={post.id} post={post} onClick={() => navigate(`/feed/${post.id}`)} showAuthor />
          ))}
        </div>
      )}
    </div>
  )
}
