import { useState, useEffect } from 'react'
import { useNavigate, useParams } from '@basicbenframework/core/client'
import { useTheme } from '../components/ThemeContext'
import { Card } from '../components/Card'
import { Avatar } from '../components/Avatar'
import { BackLink } from '../components/BackLink'
import { Link } from '../components/Link'
import { Loading } from '../components/Loading'
import { api } from '../../helpers/api'
import type { Post } from '../../types'

interface FeedPostResponse {
  post: Post
}

export function FeedPost() {
  const navigate = useNavigate()
  const params = useParams()
  const postId = params.id
  const { t } = useTheme()
  const [post, setPost] = useState<Post | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api<FeedPostResponse>(`/api/feed/${postId}`)
      .then(data => setPost(data.post))
      .catch(() => navigate('/feed'))
      .finally(() => setLoading(false))
  }, [postId])

  if (loading) return <Loading />
  if (!post) return null

  const author = post.author

  return (
    <div>
      <BackLink onClick={() => navigate('/feed')}>Back to feed</BackLink>
      <Card className="p-6">
        {post.featured_image_url && (
          <img
            src={post.featured_image_url}
            alt=""
            className="w-full max-h-96 object-cover rounded-lg mb-6"
          />
        )}

        <h1 className="text-2xl font-bold mb-3">{post.title}</h1>

        {/* The byline. A name on its own was all there was to show until every
            user had a profile to attach to a post. */}
        <div className="flex items-center gap-2 mb-6">
          <Avatar name={post.author_name || ''} src={author?.avatar_url} size="sm" />
          <p className={`text-sm ${t.muted}`}>
            By {post.author_name} &bull; {new Date(post.created_at).toLocaleDateString()}
          </p>
        </div>

        <p className="whitespace-pre-wrap">{post.content}</p>
      </Card>

      {/* Everything a reader can learn about whoever wrote it, which until now
          was their name and nothing else. */}
      {author?.bio && (
        <Card className="p-6 mt-4">
          <div className="flex gap-3">
            <Avatar name={author.name} src={author.avatar_url} size="lg" />
            <div>
              <p className="font-medium">{author.name}</p>
              <p className={`text-sm ${t.muted} mt-1`}>{author.bio}</p>
              {/* Link rather than a bare anchor: it passes an external href
                  straight through, and the router owns every other one. */}
              {author.website && (
                <Link
                  href={author.website}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="text-sm underline mt-1 inline-block"
                >
                  {author.website}
                </Link>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
