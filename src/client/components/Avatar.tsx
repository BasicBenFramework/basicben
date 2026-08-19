import { useTheme } from './ThemeContext'

/**
 * An author's face, or their initial when they have not uploaded one.
 *
 * The initial is the fallback rather than a placeholder image: it is legible at
 * every size, needs no request, and cannot 404. `src` is a resolved URL — the
 * server turns the stored media id into one, because only it knows where files
 * are actually served from.
 */

interface AvatarProps {
  name: string
  src?: string | null
  size?: 'sm' | 'md' | 'lg'
}

export function Avatar({ name, src, size = 'md' }: AvatarProps) {
  const { dark } = useTheme()
  const sizes = { sm: 'w-6 h-6 text-xs', md: 'w-8 h-8 text-sm', lg: 'w-12 h-12 text-base' }

  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={`${sizes[size]} rounded-full object-cover shrink-0`}
      />
    )
  }

  return (
    <div className={`${sizes[size]} shrink-0 rounded-full flex items-center justify-center font-medium ${dark ? 'bg-white text-black' : 'bg-black text-white'}`}>
      {(name?.[0] || '?').toUpperCase()}
    </div>
  )
}
