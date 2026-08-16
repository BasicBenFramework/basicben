import { useState, useEffect } from 'react'
import { useNavigate, ThemeLayout } from '@basicbenframework/core/client'
import { PageHeader } from '../components/PageHeader'
import { PostCard } from '../components/PostCard'
import { Loading } from '../components/Loading'
import { Empty } from '../components/Empty'
import { api } from '../../helpers/api'

export function Feed() {
  const navigate = useNavigate()
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api('/api/feed').then(data => setPosts(data.posts)).finally(() => setLoading(false))
  }, [])

  if (loading) return <Loading />

  /*
    The active theme's ArchiveLayout renders this list if it provides one;
    otherwise the app's own markup below does. That fallback is what makes a
    theme optional rather than required — and it is why these theme files are
    no longer inert: before this, nothing imported them at all.
  */
  return (
    <ThemeLayout
      layout="ArchiveLayout"
      posts={posts}
      title="Feed"
      fallback={<Loading />}
    >
      {() => (
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
      )}
    </ThemeLayout>
  )
}
