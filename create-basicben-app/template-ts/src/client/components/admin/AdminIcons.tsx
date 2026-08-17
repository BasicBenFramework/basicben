import React from 'react'

/**
 * Line icons for the admin navigation.
 *
 * Emoji were doing this job, which is why the sidebar never looked like the
 * rest of the interface: they carry their own colour, render differently on
 * every platform, and cannot inherit the text colour of the item they sit in.
 * These are stroked paths, so they take `currentColor` and match whatever the
 * nav item is doing.
 *
 * Plugins add menu items through the `admin.menu` hook and supply an emoji, so
 * anything unrecognised falls back to what the plugin sent, and then to a dot.
 */

const paths: Record<string, React.ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
    </>
  ),
  posts: (
    <>
      <path d="M4 4h16v16H4z" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </>
  ),
  pages: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </>
  ),
  categories: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  tags: (
    <>
      <path d="M3 11V5a2 2 0 0 1 2-2h6l10 10-8 8z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </>
  ),
  comments: <path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z" />,
  media: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M21 16l-5-5-5 5-3-3-5 5" />
    </>
  ),
  plugins: (
    <>
      <path d="M9 3v4M15 3v4" />
      <path d="M5 7h14v6a6 6 0 0 1-12 0z" />
      <path d="M12 19v2" />
    </>
  ),
  updates: (
    <>
      <path d="M12 20V4" />
      <path d="M6 10l6-6 6 6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 11 4a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 20 11a2 2 0 1 1 0 4z" />
    </>
  ),
  site: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" />
    </>
  )
}

/** Menu paths are stable, so the icon is chosen from the route rather than a label. */
const byPath: Record<string, string> = {
  '/admin': 'dashboard',
  '/admin/posts': 'posts',
  '/admin/pages': 'pages',
  '/admin/categories': 'categories',
  '/admin/tags': 'tags',
  '/admin/comments': 'comments',
  '/admin/media': 'media',
  '/admin/plugins': 'plugins',
  '/admin/updates': 'updates',
  '/admin/settings': 'settings'
}

interface AdminIconProps {
  /** Menu path, used to pick the icon. */
  path?: string
  /** Icon name, when there is no route to key off. */
  name?: string
  /** What a plugin supplied; shown when the path is not one of ours. */
  fallback?: string
}

export default function AdminIcon({ path, name, fallback }: AdminIconProps) {
  const key = name || (path ? byPath[path] : undefined)
  const glyph = key ? paths[key] : undefined

  if (!glyph) {
    return (
      <span className="admin-nav-icon admin-nav-icon-fallback" aria-hidden="true">
        {fallback || '•'}
      </span>
    )
  }

  return (
    <svg
      className="admin-nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {glyph}
    </svg>
  )
}
