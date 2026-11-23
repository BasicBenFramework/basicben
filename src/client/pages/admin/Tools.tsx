import React, { useState } from 'react'
import AdminLayout from '../../layouts/AdminLayout'

/**
 * Export and import.
 *
 * Export is a button because it is safe: it reads, it never writes, and its
 * output leaves out every credential. Import is not a button, deliberately.
 * An import writes a whole site into the database, creates accounts and can
 * run for minutes — the wrong shape for a request a serverless host may cut
 * off at ten seconds, and the wrong thing to make one click away. It runs
 * from a shell with a dry run first, so this page explains how.
 */
export default function AdminTools() {
  const [revisions, setRevisions] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleExport = async () => {
    setBusy(true)
    setError(null)

    try {
      // A plain link cannot carry the bearer token the API authenticates
      // with, so the file is fetched and handed to the browser as a blob.
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/export${revisions ? '?revisions=1' : ''}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      })

      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || `Export failed (${res.status})`)
      }

      const blob = await res.blob()
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1]
        ?? 'basicben-export.json'
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError((err as Error).message || 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdminLayout title="Tools">
      <style>{toolStyles}</style>

      <div className="admin-card">
        <div className="admin-card-header">
          <h2 className="admin-card-title">Export</h2>
        </div>

        <div className="tools-body">
          <p>
            Download the whole site as one JSON file: posts, pages, categories, tags, comments,
            users, media records, settings, and menus and redirects where those exist.
          </p>
          <p className="tools-muted">
            Passwords, two-factor secrets, passkeys, API tokens and credential-looking settings
            are never included. Media files themselves are not in the file — only their records.
          </p>

          <label className="tools-check">
            <input type="checkbox" checked={revisions} onChange={e => setRevisions(e.target.checked)} />
            Include revision history (can make the file much larger)
          </label>

          {error && <div className="tools-error">{error}</div>}

          <div>
            <button type="button" className="admin-btn admin-btn-primary" onClick={handleExport} disabled={busy}>
              {busy ? 'Exporting…' : 'Download export'}
            </button>
          </div>
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card-header">
          <h2 className="admin-card-title">Import</h2>
        </div>

        <div className="tools-body">
          <p>
            Imports run from a terminal on a machine that can reach the database, not from this
            page — they write a lot and can take a while. Every importer has a <code>--dry-run</code>{' '}
            that reports what it would do and writes nothing. Run that first.
          </p>

          <dl className="tools-list">
            <dt>Another BasicBen site (an export from the button above)</dt>
            <dd><code>node --env-file=.env scripts/import-json.mjs basicben-export.json --dry-run</code></dd>

            <dt>WordPress export file (Tools → Export in wp-admin)</dt>
            <dd><code>node --env-file=.env scripts/import-wxr.mjs wordpress.xml --dry-run</code></dd>

            <dt>A live WordPress site, over its REST API</dt>
            <dd><code>node --env-file=.env scripts/import-wordpress.mjs --url https://old.example.com --dry-run</code></dd>

            <dt>Ghost export (Settings → Labs → Export)</dt>
            <dd><code>node --env-file=.env scripts/import-ghost.mjs ghost.json --url https://old.example.com --dry-run</code></dd>
          </dl>

          <p className="tools-muted">
            Content that already exists here (matched by slug) is left alone unless you pass{' '}
            <code>--update</code>, so re-running is safe. Imported authors get the Author role and
            no password; they sign in with “forgot password”. Media is recorded at its existing
            address, not copied. See <code>docs/import-export.md</code> for the details.
          </p>
        </div>
      </div>
    </AdminLayout>
  )
}

const toolStyles = `
  .tools-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    font-size: 14px;
    color: var(--fg);
  }

  .tools-body p {
    margin: 0;
  }

  .tools-muted {
    color: var(--fg-muted);
    font-size: 13px;
  }

  .tools-check {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }

  .tools-error {
    padding: 10px 14px;
    border-radius: 8px;
    border: 1px solid var(--danger);
    background: var(--tint-danger);
    color: var(--danger);
    font-size: 13px;
  }

  .tools-body code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    background: var(--surface-hover);
    border-radius: 4px;
    padding: 2px 6px;
    overflow-wrap: anywhere;
  }

  .tools-list {
    margin: 0;
  }

  .tools-list dt {
    font-weight: 600;
    font-size: 13px;
    margin-top: 8px;
  }

  .tools-list dd {
    margin: 4px 0 0;
  }
`
