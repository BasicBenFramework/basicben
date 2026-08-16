import React from 'react'

export default function Footer({
  siteName,
  siteDescription,
  socialLinks,
  navigation
}) {
  return (
    <footer className="theme-footer">
      <div className="theme-container">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '2rem', textAlign: 'left', marginBottom: '2rem' }}>
          {/* About Section */}
          <div>
            <h4 style={{ marginBottom: '1rem' }}>{siteName}</h4>
            {siteDescription && (
              <p className="theme-text-muted">{siteDescription}</p>
            )}
          </div>

          {/* Navigation */}
          {navigation && navigation.length > 0 && (
            <div>
              <h4 style={{ marginBottom: '1rem' }}>Links</h4>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {navigation.map(item => (
                  <li key={item.href} style={{ marginBottom: '0.5rem' }}>
                    <a href={item.href} className="theme-text-muted">
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Social Links */}
          {socialLinks && socialLinks.length > 0 && (
            <div>
              <h4 style={{ marginBottom: '1rem' }}>Follow Us</h4>
              <div style={{ display: 'flex', gap: '1rem' }}>
                {socialLinks.map(link => (
                  <a
                    key={link.name}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="theme-text-muted"
                  >
                    {link.name}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1rem' }}>
          <p className="theme-text-muted">
            &copy; {new Date().getFullYear()} {siteName}. All rights reserved.
          </p>
          <p className="theme-text-muted" style={{ fontSize: 'var(--text-sm)' }}>
            Powered by <a href="https://basicben.com">BasicBen CMS</a>
          </p>
        </div>
      </div>
    </footer>
  )
}
