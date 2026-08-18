import React, { useState, useEffect } from 'react'
import { api } from '../../helpers/api'
import { useAuth, useNavigate, usePath } from '@basicbenframework/core/client'
import AdminIcon from '../components/admin/AdminIcons'
import { Link } from '../components/Link'

interface MenuItem {
  path: string
  label: string
  icon?: string
}

interface AdminLayoutProps {
  children: React.ReactNode
  title?: string
}

type Appearance = 'system' | 'light' | 'dark'

const THEME_KEY = 'admin-theme'

function storedAppearance(): Appearance {
  if (typeof localStorage === 'undefined') return 'system'
  const value = localStorage.getItem(THEME_KEY)
  return value === 'light' || value === 'dark' ? value : 'system'
}

export default function AdminLayout({ children, title }: AdminLayoutProps) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const currentPath = usePath()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [appearance, setAppearance] = useState<Appearance>(storedAppearance)

  useEffect(() => {
    if (appearance === 'system') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, appearance)
  }, [appearance])

  const handleLogout = () => {
    logout()
    navigate('/auth')
  }

  /*
    The menu comes from the server, because that is the realm hooks run in.
    Firing admin.menu in the browser would consult a registry nothing has
    registered with, so a listener could never add a nav item.

    The same list is hard-coded as a fallback: the sidebar must render even if
    the request fails, and it must not flash empty while the request is in
    flight.
  */
  const DEFAULT_MENU: MenuItem[] = [
    { path: '/admin', label: 'Dashboard' },
    { path: '/admin/posts', label: 'Posts' },
    { path: '/admin/pages', label: 'Pages' },
    { path: '/admin/categories', label: 'Categories' },
    { path: '/admin/tags', label: 'Tags' },
    { path: '/admin/comments', label: 'Comments' },
    { path: '/admin/media', label: 'Media' },
    { path: '/admin/tokens', label: 'API tokens' },
    { path: '/admin/settings', label: 'Settings' },
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

    // Lets an admin.init listener do one-off setup before the first screen renders.
    api.post('/api/admin/init').catch(() => {})

    return () => { cancelled = true }
  }, [])

  // 'system' sets no attribute, which is what lets the media query decide.
  const themeAttr = appearance === 'system' ? undefined : appearance

  return (
    <div className="admin-layout" data-theme={themeAttr}>
      <style>{adminStyles}</style>

      <aside className={`admin-sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="admin-sidebar-header">
          <Link href="/" className="admin-logo" title="BasicBen">
            <span className="admin-logo-mark">B</span>
            {sidebarOpen && <span className="admin-logo-text">BasicBen</span>}
          </Link>
        </div>

        <nav className="admin-nav">
          {menuItems.map(item => (
            <Link
              key={item.path}
              href={item.path}
              className={`admin-nav-item ${currentPath === item.path ? 'active' : ''}`}
              title={sidebarOpen ? undefined : item.label}
            >
              <AdminIcon path={item.path} fallback={item.icon} />
              {sidebarOpen && <span className="admin-nav-label">{item.label}</span>}
            </Link>
          ))}
        </nav>

        <div className="admin-sidebar-footer">
          {/* There is no site to view without a public one, and `/` is the
              dashboard you are already looking at. */}
          {!__DISABLE_PUBLIC_SITE__ && (
            <Link href="/" className="admin-nav-item" title={sidebarOpen ? undefined : 'View site'}>
              <AdminIcon name="site" />
              {sidebarOpen && <span className="admin-nav-label">View site</span>}
            </Link>
          )}
          <button
            className="admin-nav-item admin-collapse"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            <svg
              className="admin-nav-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              style={{ transform: sidebarOpen ? 'none' : 'rotate(180deg)' }}
            >
              <path d="M15 6l-6 6 6 6" />
            </svg>
            {sidebarOpen && <span className="admin-nav-label">Collapse</span>}
          </button>
        </div>
      </aside>

      <div className={`admin-main ${sidebarOpen ? '' : 'expanded'}`}>
        <header className="admin-header">
          {title && <h1 className="admin-page-title">{title}</h1>}

          <div className="admin-header-right">
            <div className="admin-appearance" role="group" aria-label="Appearance">
              {(['system', 'light', 'dark'] as Appearance[]).map(option => (
                <button
                  key={option}
                  type="button"
                  className={`admin-appearance-option ${appearance === option ? 'active' : ''}`}
                  onClick={() => setAppearance(option)}
                  title={`${option[0].toUpperCase()}${option.slice(1)} theme`}
                  aria-pressed={appearance === option}
                >
                  {option === 'system' ? '◐' : option === 'light' ? '☀' : '☾'}
                </button>
              ))}
            </div>

            <span className="admin-user">{user?.name || 'Admin'}</span>
            <button className="admin-btn admin-btn-secondary" onClick={handleLogout}>
              Log out
            </button>
          </div>
        </header>

        <main className="admin-content">
          {children}
        </main>
      </div>
    </div>
  )
}

/*
  One token set, themed three ways.

  Bare `.admin-layout` carries the light palette. The media query redefines the
  tokens for anyone whose system asks for dark *unless* they have explicitly
  chosen light, and the attribute selector wins in both directions — which is
  what makes the toggle work rather than merely agreeing with the OS.
*/
const adminStyles = `
  .admin-layout {
    --bg: #fafafa;
    --surface: #ffffff;
    --surface-hover: #f4f4f5;
    --surface-active: #ededee;
    --border: #e7e7e9;
    --border-strong: #d4d4d8;
    --fg: #09090b;
    --fg-muted: #64646b;
    --fg-subtle: #909099;
    --accent: #09090b;
    --accent-fg: #ffffff;
    --focus: #0070f3;
    --danger: #e5484d;
    --danger-fg: #ffffff;
    --success: #1a7f45;
    --warning: #9a6700;
    --info: #0060df;
    --tint-success: #e8f5ec;
    --tint-warning: #fdf5e3;
    --tint-info: #e8f1fd;
    --tint-danger: #fdeaea;
    --radius: 8px;
    --radius-lg: 12px;
    --sidebar-w: 232px;
    --sidebar-w-closed: 60px;

    display: flex;
    min-height: 100vh;
    background: var(--bg);
    color: var(--fg);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
      "Helvetica Neue", Arial, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  @media (prefers-color-scheme: dark) {
    .admin-layout:not([data-theme="light"]) {
      --bg: #0a0a0a;
      --surface: #111113;
      --surface-hover: #18181b;
      --surface-active: #202024;
      --border: #232327;
      --border-strong: #333338;
      --fg: #ededef;
      --fg-muted: #a1a1a8;
      --fg-subtle: #70707a;
      --accent: #ededef;
      --accent-fg: #09090b;
      --focus: #3b82f6;
      --danger: #f2555a;
      --danger-fg: #0a0a0a;
      --success: #3dd68c;
      --warning: #f5b544;
      --info: #6aa6ff;
      --tint-success: #10261a;
      --tint-warning: #2a2011;
      --tint-info: #11213a;
      --tint-danger: #2c1315;
    }
  }

  .admin-layout[data-theme="dark"] {
    --bg: #0a0a0a;
    --surface: #111113;
    --surface-hover: #18181b;
    --surface-active: #202024;
    --border: #232327;
    --border-strong: #333338;
    --fg: #ededef;
    --fg-muted: #a1a1a8;
    --fg-subtle: #70707a;
    --accent: #ededef;
    --accent-fg: #09090b;
    --focus: #3b82f6;
    --danger: #f2555a;
    --danger-fg: #0a0a0a;
    --success: #3dd68c;
    --warning: #f5b544;
    --info: #6aa6ff;
    --tint-success: #10261a;
    --tint-warning: #2a2011;
    --tint-info: #11213a;
    --tint-danger: #2c1315;
  }

  .admin-layout *,
  .admin-layout *::before,
  .admin-layout *::after { box-sizing: border-box; }

  /* --- Sidebar ----------------------------------------------------------- */

  .admin-sidebar {
    width: var(--sidebar-w);
    background: var(--surface);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    position: fixed;
    top: 0;
    left: 0;
    height: 100vh;
    z-index: 100;
    transition: width 0.15s ease;
  }

  .admin-sidebar.closed { width: var(--sidebar-w-closed); }

  .admin-sidebar-header {
    display: flex;
    align-items: center;
    height: 56px;
    padding: 0 12px;
    border-bottom: 1px solid var(--border);
  }

  .admin-logo {
    display: flex;
    align-items: center;
    gap: 8px;
    text-decoration: none;
    color: var(--fg);
    font-weight: 600;
    letter-spacing: -0.01em;
    padding: 6px;
    border-radius: var(--radius);
  }

  .admin-logo:hover { background: var(--surface-hover); }

  .admin-logo-mark {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    border-radius: 6px;
    background: var(--accent);
    color: var(--accent-fg);
    font-size: 13px;
    font-weight: 700;
  }

  .admin-nav {
    flex: 1;
    padding: 8px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .admin-nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 8px;
    border-radius: var(--radius);
    color: var(--fg-muted);
    text-decoration: none;
    font-size: 13.5px;
    font-weight: 450;
    white-space: nowrap;
    border: none;
    background: none;
    width: 100%;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.12s, color 0.12s;
  }

  .admin-nav-item:hover { background: var(--surface-hover); color: var(--fg); }
  .admin-nav-item.active { background: var(--surface-active); color: var(--fg); font-weight: 550; }

  .admin-nav-icon {
    width: 17px;
    height: 17px;
    flex-shrink: 0;
    opacity: 0.85;
  }

  .admin-nav-icon-fallback {
    display: grid;
    place-items: center;
    font-size: 13px;
    line-height: 1;
  }

  .admin-sidebar-footer {
    padding: 8px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  /* --- Main -------------------------------------------------------------- */

  .admin-main {
    flex: 1;
    margin-left: var(--sidebar-w);
    min-width: 0;
    transition: margin-left 0.15s ease;
  }

  .admin-main.expanded { margin-left: var(--sidebar-w-closed); }

  .admin-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    height: 56px;
    padding: 0 24px;
    background: color-mix(in srgb, var(--surface) 80%, transparent);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 50;
  }

  .admin-page-title {
    font-size: 15px;
    font-weight: 550;
    letter-spacing: -0.01em;
    margin: 0;
  }

  .admin-header-right {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-left: auto;
  }

  .admin-user { color: var(--fg-muted); font-size: 13px; }

  .admin-appearance {
    display: flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .admin-appearance-option {
    width: 24px;
    height: 22px;
    display: grid;
    place-items: center;
    border: none;
    background: none;
    border-radius: 5px;
    color: var(--fg-subtle);
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
  }

  .admin-appearance-option:hover { color: var(--fg); background: var(--surface-hover); }
  .admin-appearance-option.active { color: var(--fg); background: var(--surface-active); }

  .admin-content { padding: 24px; max-width: 1400px; }

  /* --- Cards ------------------------------------------------------------- */

  .admin-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 20px;
    margin-bottom: 16px;
  }

  .admin-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
  }

  .admin-card-title {
    font-size: 14px;
    font-weight: 550;
    letter-spacing: -0.01em;
    margin: 0;
  }

  /* Pages that use a bare title rather than a header row get the same gap the
     header would have given them, instead of the title sitting on top of the
     first field. */
  .admin-card > .admin-card-title { margin-bottom: 16px; }

  .admin-stat-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 16px 18px;
  }

  .admin-stat-label {
    color: var(--fg-muted);
    font-size: 12.5px;
    margin: 0 0 6px;
  }

  .admin-stat-value {
    font-size: 26px;
    font-weight: 600;
    letter-spacing: -0.02em;
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  /* --- Grid -------------------------------------------------------------- */

  .admin-grid { display: grid; gap: 16px; }
  .admin-grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .admin-grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .admin-grid-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }

  @media (max-width: 900px) {
    .admin-grid-2, .admin-grid-3, .admin-grid-4 { grid-template-columns: minmax(0, 1fr); }
  }

  /* --- Buttons ----------------------------------------------------------- */

  .admin-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    border-radius: var(--radius);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    color: var(--fg);
    font-family: inherit;
    font-size: 13px;
    font-weight: 500;
    line-height: 1;
    cursor: pointer;
    text-decoration: none;
    white-space: nowrap;
    transition: background 0.12s, border-color 0.12s, opacity 0.12s;
  }

  .admin-btn:hover { background: var(--surface-hover); }
  .admin-btn:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  .admin-btn:disabled { opacity: 0.5; cursor: default; }
  .admin-btn:disabled:hover { background: var(--surface); }

  .admin-btn-primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-fg);
  }

  .admin-btn-primary:hover { background: var(--accent); opacity: 0.85; }
  .admin-btn-primary:disabled:hover { background: var(--accent); }

  .admin-btn-secondary { background: var(--surface); color: var(--fg); }

  /* Creating a category or tag from inside the post editor, so adding one does
     not mean leaving an unsaved draft to visit another page. */
  .admin-inline-add {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .admin-inline-add .admin-input { flex: 1; min-width: 0; }
  .admin-inline-add .admin-btn:disabled { opacity: 0.45; cursor: default; }

  /* A checkbox list that scrolls rather than pushing the rest of the sidebar
     off the screen. A site with eighty categories is normal. */
  .admin-term-list {
    max-height: 12rem;
    overflow-y: auto;
    padding: 0.5rem 0.625rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
  }

  .admin-term-option {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.1875rem 0;
    font-size: 0.875rem;
    cursor: pointer;
  }

  .admin-term-option input { cursor: pointer; }
  .admin-term-option:hover { color: var(--accent); }

  .admin-term-empty {
    margin: 0;
    color: var(--fg-muted);
    font-size: 0.875rem;
  }

  .admin-term-add {
    margin-top: 0.625rem;
    padding: 0;
    border: none;
    background: none;
    color: var(--accent);
    font-size: 0.875rem;
    cursor: pointer;
  }

  .admin-term-add:hover { text-decoration: underline; }

  /* The tags actually on the post, each removable — so the selection is
     visible without opening anything. */
  .admin-term-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    margin-top: 0.625rem;
  }

  .admin-term-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.1875rem 0.5rem;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: var(--surface);
    font-size: 0.8125rem;
  }

  .admin-term-chip button {
    padding: 0;
    border: none;
    background: none;
    color: var(--fg-muted);
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
  }

  .admin-term-chip button:hover { color: var(--danger); }

  .admin-term-details { margin-top: 0.75rem; }

  .admin-term-details summary {
    color: var(--fg-muted);
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .admin-term-details summary:hover { color: var(--accent); }
  .admin-term-details .admin-term-list { margin-top: 0.5rem; }

  /* --- Markdown editor -------------------------------------------------------
     Every colour here was a hardcoded hex in the component's inline styles: a
     #f9fafb toolbar, #d1d5db borders, a #ffffff preview. Inline styles cannot
     answer to a theme, so the editor stayed lit while the rest of the admin
     went dark. These are the same variables everything else uses. */

  .markdown-editor-bar {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-wrap: wrap;
    padding: 0.375rem;
    border: 1px solid var(--border);
    border-bottom: none;
    border-radius: var(--radius) var(--radius) 0 0;
    background: var(--surface);
  }

  .markdown-editor-mark {
    min-width: 2rem;
    padding: 0.25rem 0.5rem;
    border: 1px solid transparent;
    border-radius: 0.25rem;
    background: transparent;
    color: var(--fg);
    font-size: 0.875rem;
    cursor: pointer;
  }

  .markdown-editor-mark:hover:not(:disabled) { background: var(--surface-hover); }
  .markdown-editor-mark:disabled { opacity: 0.4; cursor: default; }

  .markdown-editor-tabs { margin-left: auto; display: flex; gap: 0.25rem; }

  .markdown-editor-tab {
    padding: 0.25rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.25rem;
    background: transparent;
    color: var(--fg-muted);
    font-size: 0.875rem;
    text-transform: capitalize;
    cursor: pointer;
  }

  .markdown-editor-tab.active {
    background: var(--bg);
    color: var(--fg);
    font-weight: 600;
  }

  .markdown-editor-input {
    border-radius: 0 0 var(--radius) var(--radius);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.875rem;
    line-height: 1.6;
  }

  .markdown-editor-hint {
    margin: 0.375rem 0 0;
    color: var(--fg-subtle);
    font-size: 0.8125rem;
  }

  .markdown-editor-error { color: var(--danger); }
  .markdown-editor-empty { color: var(--fg-subtle); }

  /* The preview had no typography at all — rendered HTML fell back to browser
     defaults inside a page that resets them, so headings, lists and code came
     out flat and cramped. It is a preview; it has to look like prose. */
  .markdown-editor-preview {
    padding: 1rem 1.125rem;
    border: 1px solid var(--border);
    border-radius: 0 0 var(--radius) var(--radius);
    background: var(--bg);
    color: var(--fg);
    overflow-wrap: break-word;
    line-height: 1.7;
  }

  .markdown-editor-preview > :first-child { margin-top: 0; }
  .markdown-editor-preview > :last-child { margin-bottom: 0; }

  .markdown-editor-preview h1,
  .markdown-editor-preview h2,
  .markdown-editor-preview h3,
  .markdown-editor-preview h4 {
    margin: 1.6em 0 0.6em;
    line-height: 1.25;
    font-weight: 650;
    color: var(--fg);
  }

  .markdown-editor-preview h1 { font-size: 1.75rem; }
  .markdown-editor-preview h2 { font-size: 1.4rem; }
  .markdown-editor-preview h3 { font-size: 1.15rem; }
  .markdown-editor-preview h4 { font-size: 1rem; }

  .markdown-editor-preview p { margin: 0 0 1em; }

  .markdown-editor-preview ul,
  .markdown-editor-preview ol { margin: 0 0 1em; padding-left: 1.5rem; }
  .markdown-editor-preview li { margin: 0.25em 0; }
  .markdown-editor-preview li > ul,
  .markdown-editor-preview li > ol { margin: 0.25em 0; }

  .markdown-editor-preview a { color: var(--accent); text-decoration: underline; }

  .markdown-editor-preview blockquote {
    margin: 0 0 1em;
    padding: 0.25rem 0 0.25rem 1rem;
    border-left: 3px solid var(--border-strong);
    color: var(--fg-muted);
  }

  .markdown-editor-preview code {
    padding: 0.15em 0.35em;
    border-radius: 0.25rem;
    background: var(--surface);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.875em;
  }

  .markdown-editor-preview pre {
    margin: 0 0 1em;
    padding: 0.875rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    /* Long lines scroll inside the block rather than widening the editor. */
    overflow-x: auto;
  }

  .markdown-editor-preview pre code {
    padding: 0;
    background: none;
    font-size: 0.8125rem;
  }

  .markdown-editor-preview img {
    max-width: 100%;
    height: auto;
    border-radius: var(--radius);
  }

  .markdown-editor-preview hr {
    margin: 1.75em 0;
    border: none;
    border-top: 1px solid var(--border);
  }

  .markdown-editor-preview table {
    width: 100%;
    margin: 0 0 1em;
    border-collapse: collapse;
    font-size: 0.9375rem;
  }

  .markdown-editor-preview th,
  .markdown-editor-preview td {
    padding: 0.5rem 0.625rem;
    border: 1px solid var(--border);
    text-align: left;
  }

  .markdown-editor-preview th { background: var(--surface); font-weight: 600; }

  /* Pager for the admin tables. Sits under the table, quiet by default: the
     controls only matter when there is more than one page, and the component
     renders nothing at all in that case. */
  .admin-pagination {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }

  .admin-pagination-summary {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--muted);
  }

  .admin-pagination-controls {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .admin-pagination-position {
    font-size: 0.8125rem;
    color: var(--muted);
    /* Keeps Previous and Next from shuffling sideways as the digits change. */
    min-width: 9ch;
    text-align: center;
  }

  .admin-pagination .admin-btn:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .admin-btn-danger {
    background: transparent;
    border-color: var(--border-strong);
    color: var(--danger);
  }

  .admin-btn-danger:hover { background: var(--tint-danger); border-color: var(--danger); }

  /* --- Forms ------------------------------------------------------------- */

  .admin-form-group { margin-bottom: 16px; }

  .admin-label {
    display: block;
    margin-bottom: 6px;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--fg-muted);
  }

  .admin-input,
  .admin-select,
  .admin-textarea {
    width: 100%;
    min-height: 32px;
    padding: 6px 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--fg);
    font-family: inherit;
    font-size: 13.5px;
    line-height: 1.4;
    transition: border-color 0.12s, box-shadow 0.12s;
  }

  .admin-input::placeholder,
  .admin-textarea::placeholder { color: var(--fg-subtle); }

  .admin-input:focus,
  .admin-select:focus,
  .admin-textarea:focus {
    outline: none;
    border-color: var(--focus);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 18%, transparent);
  }

  .admin-textarea { min-height: 120px; resize: vertical; }

  .admin-select {
    appearance: none;
    padding-right: 28px;
    background-image: linear-gradient(45deg, transparent 50%, currentColor 50%),
      linear-gradient(135deg, currentColor 50%, transparent 50%);
    background-position: calc(100% - 15px) 14px, calc(100% - 11px) 14px;
    background-size: 4px 4px, 4px 4px;
    background-repeat: no-repeat;
  }

  /* --- Table ------------------------------------------------------------- */

  .admin-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13.5px;
  }

  .admin-table th {
    text-align: left;
    padding: 8px 12px;
    color: var(--fg-muted);
    font-weight: 500;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }

  .admin-table td {
    padding: 11px 12px;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }

  .admin-table tr:last-child td { border-bottom: none; }
  .admin-table tbody tr:hover { background: var(--surface-hover); }

  /* --- Badges ------------------------------------------------------------ */

  .admin-badge {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 8px;
    border-radius: 999px;
    font-size: 11.5px;
    font-weight: 500;
    background: var(--surface-active);
    color: var(--fg-muted);
    white-space: nowrap;
  }

  .admin-badge-success { background: var(--tint-success); color: var(--success); }
  .admin-badge-warning { background: var(--tint-warning); color: var(--warning); }
  .admin-badge-info    { background: var(--tint-info);    color: var(--info); }
  .admin-badge-danger  { background: var(--tint-danger);  color: var(--danger); }

  /* --- States ------------------------------------------------------------ */

  /* Used by every page and previously undefined, so a loading screen was
     unstyled black text in the corner. */
  .admin-loading,
  .admin-empty {
    padding: 40px 20px;
    text-align: center;
    color: var(--fg-muted);
    font-size: 13.5px;
  }

  /* Plain links inherit; anything wearing a button class keeps the colour that
     class gave it. Without the exclusion this rule outranks .admin-btn-primary
     and paints black text onto the black button. */
  .admin-layout a:not([class*="admin-btn"]) { color: inherit; text-decoration: none; }

  /* Links in the content area carry no colour of their own — one accent in a
     neutral interface reads as noise once every table row has one — so the
     underline on hover is what marks them as links. */
  .admin-content a:not([class*="admin-btn"]):hover { text-decoration: underline; }

  @media (max-width: 700px) {
    .admin-sidebar { width: var(--sidebar-w-closed); }
    .admin-sidebar .admin-nav-label,
    .admin-sidebar .admin-logo-text { display: none; }
    .admin-main { margin-left: var(--sidebar-w-closed); }
    .admin-content { padding: 16px; }
    .admin-header { padding: 0 16px; }
  }
`
