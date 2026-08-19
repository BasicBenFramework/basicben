import { useTheme } from './ThemeContext'
import { Avatar } from './Avatar'
import type { Post } from '../../types'

interface PostCardProps {
  post: Post
  onClick: () => void
  showAuthor?: boolean
}

export function PostCard({ post, onClick, showAuthor = false }: PostCardProps) {
  const { t } = useTheme()

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 rounded-xl ${t.card} border ${t.border} hover:border-opacity-50 transition`}
    >
      {/* The featured image, when the post has one. It was a column the editor
          collected and nothing ever saved, so no listing has ever shown one. */}
      {post.featured_image_url && (
        <img
          src={post.featured_image_url}
          alt=""
          className="w-full h-40 object-cover rounded-lg mb-3"
        />
      )}

      <h2 className="font-medium mb-1">{post.title}</h2>
      <p className={`text-sm ${t.muted} line-clamp-2`}>{post.excerpt || post.content}</p>

      <div className={`flex items-center gap-2 text-xs ${t.muted} mt-2`}>
        {showAuthor && post.author_name && (
          <>
            <Avatar name={post.author_name} src={post.author?.avatar_url} size="sm" />
            <span>{post.author_name}</span>
            <span>&bull;</span>
          </>
        )}
        {post.published !== undefined && <span>{post.published ? 'Published' : 'Draft'} &bull;</span>}
        <span>{new Date(post.created_at).toLocaleDateString()}</span>
      </div>
    </button>
  )
}
