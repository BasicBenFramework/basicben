import { useTheme } from './ThemeContext'
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
      <h2 className="font-medium mb-1">{post.title}</h2>
      <p className={`text-sm ${t.muted} line-clamp-2`}>{post.content}</p>
      <p className={`text-xs ${t.muted} mt-2`}>
        {showAuthor && <>By {post.author_name} &bull; </>}
        {post.published !== undefined && <>{post.published ? 'Published' : 'Draft'} &bull; </>}
        {new Date(post.created_at).toLocaleDateString()}
      </p>
    </button>
  )
}
