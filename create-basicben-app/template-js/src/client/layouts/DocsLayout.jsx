import { useNavigate, usePath } from '@basicbenframework/core/client'
import { useTheme } from '../components/ThemeContext'
import { AppLayout } from './AppLayout'

function SidebarLink({ href, active, children }) {
  const { t } = useTheme()
  const navigate = useNavigate()

  return (
    <button
      onClick={() => navigate(href)}
      className={`block w-full text-left px-3 py-2 rounded-lg text-sm transition ${
        active ? `${t.card} font-medium` : `${t.muted} hover:opacity-70`
      }`}
    >
      {children}
    </button>
  )
}

function DocsSidebar({ children }) {
  const { t } = useTheme()
  const path = usePath()

  const docLinks = [
    { href: '/docs', label: 'Getting Started' },
    { href: '/docs/routing', label: 'Routing' },
    { href: '/docs/database', label: 'Database' },
    { href: '/docs/authentication', label: 'Authentication' },
    { href: '/docs/validation', label: 'Validation' },
    { href: '/docs/content', label: 'Content & Markdown' },
    { href: '/docs/storage', label: 'Object Storage' },
    { href: '/docs/plugins', label: 'Plugins & Themes' },
    { href: '/docs/testing', label: 'Testing' },
  ]

  return (
    <div className="flex gap-8">
      <aside className="hidden md:block w-48 flex-shrink-0">
        <nav className="sticky top-20 space-y-1">
          {docLinks.map(link => (
            <SidebarLink
              key={link.href}
              href={link.href}
              active={path === link.href}
            >
              {link.label}
            </SidebarLink>
          ))}
        </nav>
      </aside>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

export function DocsLayout({ children }) {
  return (
    <AppLayout>
      <DocsSidebar>{children}</DocsSidebar>
    </AppLayout>
  )
}
