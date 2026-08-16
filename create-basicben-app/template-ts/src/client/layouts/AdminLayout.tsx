import React, { useState, useEffect } from 'react'
import { api } from '../../helpers/api'
import { useAuth, useNavigate, usePath } from '@basicbenframework/core/client'
import UpdateBanner from '../components/admin/UpdateBanner'

interface MenuItem {
  path: string
  label: string
  icon?: string
}

interface AdminLayoutProps {
  children: React.ReactNode
  title?: string
}

export default function AdminLayout({ children, title }: AdminLayoutProps) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const currentPath = usePath()
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const handleLogout = () => {
    logout()
    navigate('/auth')
  }

  /*
    The menu comes from the server because that is the realm plugins load into.
    Firing admin.menu in the browser would consult a hook registry that no
    plugin has ever registered with, so a plugin could never add a nav item.

    The same list is hard-coded as a fallback: the sidebar must render even if
    the request fails, and it must not flash empty while the request is in
    flight.
  */
  const DEFAULT_MENU: MenuItem[] = [
    { path: '/admin', label: 'Dashboard', icon: '📊' },
    { path: '/admin/posts', label: 'Posts', icon: '📝' },
    { path: '/admin/pages', label: 'Pages', icon: '📄' },
    { path: '/admin/categories', label: 'Categories', icon: '📁' },
    { path: '/admin/tags', label: 'Tags', icon: '🏷️' },
    { path: '/admin/comments', label: 'Comments', icon: '💬' },
    { path: '/admin/media', label: 'Media', icon: '🖼️' },
    { path: '/admin/themes', label: 'Themes', icon: '🎨' },
    { path: '/admin/plugins', label: 'Plugins', icon: '🔌' },
    { path: '/admin/updates', label: 'Updates', icon: '⬆️' },
    { path: '/admin/settings', label: 'Settings', icon: '⚙️' },
  ]

  const [menuItems, setMenuItems] = useState<MenuItem[]>(DEFAULT_MENU)

  useEffect(() => {
    let cancelled = false

    api.get<{ menu: MenuItem[] }>('/api/admin/menu')
      .then((data) => {
        if (!cancelled && Array.isArray(data?.menu) && data.menu.length > 0) {
          setMenuItems(data.menu)
        }
      })
      .catch(() => { /* the built-in menu is already showing */ })

    // Lets a plugin do any one-off setup before the first admin screen renders.
    api.post('/api/admin/init').catch(() => {})

    return () => { cancelled = true }
  }, [])

  return (
    <div className="admin-layout">
      <style>{adminStyles}</style>

      {/* Sidebar */}
      <aside className={`admin-sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="admin-sidebar-header">
          <a href="/" className="admin-logo">
            BasicBen
          </a>
          <button
            className="admin-sidebar-toggle"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </div>

        <nav className="admin-nav">
          {menuItems.map(item => (
            <a
              key={item.path}
              href={item.path}
              className={`admin-nav-item ${currentPath === item.path ? 'active' : ''}`}
            >
              <span className="admin-nav-icon">{item.icon}</span>
              {sidebarOpen && <span className="admin-nav-label">{item.label}</span>}
            </a>
          ))}
        </nav>

        <div className="admin-sidebar-footer">
          <a href="/" className="admin-nav-item">
            <span className="admin-nav-icon">🌐</span>
            {sidebarOpen && <span className="admin-nav-label">View Site</span>}
          </a>
        </div>
      </aside>

      {/* Main Content */}
      <div className={`admin-main ${sidebarOpen ? '' : 'expanded'}`}>
        {/* Update Banner */}
        <UpdateBanner />

        {/* Header */}
        <header className="admin-header">
          <div className="admin-header-left">
            {title && <h1 className="admin-page-title">{title}</h1>}
          </div>
          <div className="admin-header-right">
            <span className="admin-user-name">{user?.name || 'Admin'}</span>
            <button className="admin-logout-btn" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="admin-content">
          {children}
        </main>
      </div>
    </div>
  )
}

const adminStyles = `
  .admin-layout {
    display: flex;
    min-height: 100vh;
    background-color: #f3f4f6;
  }

  .admin-sidebar {
    width: 250px;
    background-color: #1f2937;
    color: white;
    display: flex;
    flex-direction: column;
    transition: width 0.2s ease;
    position: fixed;
    top: 0;
    left: 0;
    height: 100vh;
    z-index: 100;
  }

  .admin-sidebar.closed {
    width: 60px;
  }

  .admin-sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem;
    border-bottom: 1px solid #374151;
  }

  .admin-logo {
    font-size: 1.25rem;
    font-weight: 700;
    color: white;
    text-decoration: none;
  }

  .admin-sidebar.closed .admin-logo {
    display: none;
  }

  .admin-sidebar-toggle {
    background: none;
    border: none;
    color: #9ca3af;
    cursor: pointer;
    padding: 0.5rem;
  }

  .admin-nav {
    flex: 1;
    padding: 1rem 0;
    overflow-y: auto;
  }

  .admin-nav-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    color: #d1d5db;
    text-decoration: none;
    transition: background-color 0.15s;
  }

  .admin-nav-item:hover {
    background-color: #374151;
    color: white;
  }

  .admin-nav-item.active {
    background-color: #4f46e5;
    color: white;
  }

  .admin-nav-icon {
    font-size: 1.25rem;
    width: 1.5rem;
    text-align: center;
  }

  .admin-sidebar-footer {
    border-top: 1px solid #374151;
    padding: 0.5rem 0;
  }

  .admin-main {
    flex: 1;
    margin-left: 250px;
    transition: margin-left 0.2s ease;
  }

  .admin-main.expanded {
    margin-left: 60px;
  }

  .admin-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 2rem;
    background-color: white;
    border-bottom: 1px solid #e5e7eb;
    position: sticky;
    top: 0;
    z-index: 50;
  }

  .admin-page-title {
    font-size: 1.5rem;
    font-weight: 600;
    margin: 0;
    color: #111827;
  }

  .admin-header-right {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .admin-user-name {
    color: #6b7280;
  }

  .admin-logout-btn {
    padding: 0.5rem 1rem;
    background-color: #f3f4f6;
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
    cursor: pointer;
    font-size: 0.875rem;
  }

  .admin-logout-btn:hover {
    background-color: #e5e7eb;
  }

  .admin-content {
    padding: 2rem;
  }

  /* Admin Cards */
  .admin-card {
    background-color: white;
    border-radius: 0.5rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }

  .admin-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }

  .admin-card-title {
    font-size: 1.125rem;
    font-weight: 600;
    margin: 0;
  }

  /* Admin Grid */
  .admin-grid {
    display: grid;
    gap: 1.5rem;
  }

  .admin-grid-2 {
    grid-template-columns: repeat(2, 1fr);
  }

  .admin-grid-3 {
    grid-template-columns: repeat(3, 1fr);
  }

  .admin-grid-4 {
    grid-template-columns: repeat(4, 1fr);
  }

  @media (max-width: 1024px) {
    .admin-grid-4 {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 768px) {
    .admin-grid-2,
    .admin-grid-3,
    .admin-grid-4 {
      grid-template-columns: 1fr;
    }

    .admin-sidebar {
      width: 60px;
    }

    .admin-main {
      margin-left: 60px;
    }
  }

  /* Admin Buttons */
  .admin-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    text-decoration: none;
  }

  .admin-btn-primary {
    background-color: #4f46e5;
    color: white;
    border: none;
  }

  .admin-btn-primary:hover {
    background-color: #4338ca;
  }

  .admin-btn-secondary {
    background-color: white;
    color: #374151;
    border: 1px solid #d1d5db;
  }

  .admin-btn-secondary:hover {
    background-color: #f9fafb;
  }

  .admin-btn-danger {
    background-color: #ef4444;
    color: white;
    border: none;
  }

  .admin-btn-danger:hover {
    background-color: #dc2626;
  }

  /* Admin Table */
  .admin-table {
    width: 100%;
    border-collapse: collapse;
  }

  .admin-table th,
  .admin-table td {
    padding: 0.75rem 1rem;
    text-align: left;
    border-bottom: 1px solid #e5e7eb;
  }

  .admin-table th {
    font-weight: 600;
    color: #6b7280;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .admin-table tr:hover {
    background-color: #f9fafb;
  }

  /* Admin Forms */
  .admin-form-group {
    margin-bottom: 1rem;
  }

  .admin-label {
    display: block;
    font-size: 0.875rem;
    font-weight: 500;
    color: #374151;
    margin-bottom: 0.5rem;
  }

  .admin-input,
  .admin-textarea,
  .admin-select {
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
    font-size: 0.875rem;
  }

  .admin-input:focus,
  .admin-textarea:focus,
  .admin-select:focus {
    outline: none;
    border-color: #4f46e5;
    box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
  }

  .admin-textarea {
    min-height: 150px;
    resize: vertical;
  }

  /* Stats Card */
  .admin-stat-card {
    background-color: white;
    border-radius: 0.5rem;
    padding: 1.5rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  .admin-stat-value {
    font-size: 2rem;
    font-weight: 700;
    color: #111827;
  }

  .admin-stat-label {
    font-size: 0.875rem;
    color: #6b7280;
    margin-top: 0.25rem;
  }

  /* Badge */
  .admin-badge {
    display: inline-flex;
    align-items: center;
    padding: 0.25rem 0.75rem;
    font-size: 0.75rem;
    font-weight: 500;
    border-radius: 9999px;
  }

  .admin-badge-success {
    background-color: #d1fae5;
    color: #065f46;
  }

  .admin-badge-warning {
    background-color: #fef3c7;
    color: #92400e;
  }

  .admin-badge-danger {
    background-color: #fee2e2;
    color: #991b1b;
  }

  .admin-badge-info {
    background-color: #dbeafe;
    color: #1e40af;
  }
`
