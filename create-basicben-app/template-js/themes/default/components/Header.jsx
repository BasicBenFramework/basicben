import React from 'react'

export default function Header({
  siteName,
  navigation = [
    { label: 'Home', href: '/' },
    { label: 'Blog', href: '/blog' },
    { label: 'About', href: '/about' }
  ],
  darkMode,
  onToggleDarkMode
}) {
  return (
    <header className="theme-header">
      <div className="theme-header-inner">
        <a href="/" className="theme-logo">
          {siteName}
        </a>

        <nav>
          <ul className="theme-nav">
            {navigation.map(item => (
              <li key={item.href}>
                <a href={item.href}>{item.label}</a>
              </li>
            ))}
          </ul>
        </nav>

        {onToggleDarkMode && (
          <button
            onClick={onToggleDarkMode}
            className="theme-btn theme-btn-secondary"
            aria-label="Toggle dark mode"
          >
            {darkMode ? '☀️' : '🌙'}
          </button>
        )}
      </div>
    </header>
  )
}
