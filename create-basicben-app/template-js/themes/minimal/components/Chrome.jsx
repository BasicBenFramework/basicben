import React from 'react'

/**
 * The minimal theme's header and footer.
 *
 * Deliberately its own copy rather than an import from `themes/default`.
 * Themes have to be independently installable and removable, so one reaching
 * into another's files would mean uninstalling `default` breaks `minimal` —
 * a coupling that is much worse than two small components.
 */

const DEFAULT_NAV = [
  { label: 'Home', href: '/' },
  { label: 'Writing', href: '/blog' }
]

export function Header({ siteName, navigation = DEFAULT_NAV }) {
  return (
    <header className="theme-header">
      <div className="theme-header-inner">
        <a href="/" className="theme-logo">{siteName}</a>
        <nav>
          <ul className="theme-nav">
            {navigation.map(item => (
              <li key={item.href}>
                <a href={item.href}>{item.label}</a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  )
}

export function Footer({ siteName }) {
  return (
    <footer className="theme-footer">
      <div className="theme-container">
        <p>&copy; {new Date().getFullYear()} {siteName}</p>
      </div>
    </footer>
  )
}
