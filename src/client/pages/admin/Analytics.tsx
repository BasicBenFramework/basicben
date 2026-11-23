import React, { useEffect, useState } from 'react'
import { useAuth } from '@basicbenframework/core/client'
import { can } from '@basicbenframework/core/auth/permissions'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'

interface Day {
  day: string
  views: number
  visitors: number
}

interface Summary {
  days: number
  from: string
  to: string
  totals: { views: number; visitors: number }
  series: Day[]
  top_paths: Array<{ path: string; views: number; visitors: number }>
  top_referrers: Array<{ domain: string; views: number }>
}

interface AnalyticsSettings {
  analytics_enabled: boolean
  analytics_dedup_hours: number
  analytics_retention_days: number
}

const RANGES = [7, 30, 90]
const fmt = (n: number) => n.toLocaleString()

/**
 * Page views and visitors, counted without cookies.
 *
 * What is behind these numbers is deliberately thin — daily counts per path
 * and per referring domain, nothing per person (docs/analytics.md) — so the
 * page shows exactly that and says what it cannot: visitors over a range are
 * a sum of daily visitors, because the hashes that would make them unique
 * across days are deleted every day.
 */
export default function AdminAnalytics() {
  const { user } = useAuth() as { user: { role?: string } | null }
  const mayConfigure = can(user as { role?: string } | null, 'settings.manage')

  const [days, setDays] = useState(30)
  const [data, setData] = useState<Summary | null>(null)
  const [settings, setSettings] = useState<AnalyticsSettings | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  useEffect(() => {
    let live = true
    setError('')
    api.get<{ data: Summary; settings: AnalyticsSettings }>(`/api/admin/analytics?days=${days}`)
      .then((res) => {
        if (!live) return
        setData(res.data)
        setSettings((current) => current ?? res.settings)
      })
      .catch((err) => live && setError((err as Error).message))
    return () => { live = false }
  }, [days])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!settings) return
    setSaved('')
    try {
      await api.put('/api/settings', {
        settings: {
          analytics_enabled: settings.analytics_enabled,
          analytics_dedup_hours: settings.analytics_dedup_hours,
          analytics_retention_days: settings.analytics_retention_days
        }
      })
      setSaved('Saved.')
    } catch (err) {
      setSaved((err as Error).message)
    }
  }

  return (
    <AdminLayout title="Analytics">
      <style>{analyticsStyles}</style>

      <div className="an-toolbar" role="group" aria-label="Range">
        {RANGES.map((n) => (
          <button
            key={n}
            type="button"
            className={`admin-btn ${n === days ? 'admin-btn-primary' : 'admin-btn-secondary'}`}
            aria-pressed={n === days}
            onClick={() => setDays(n)}
          >
            {n} days
          </button>
        ))}
      </div>

      {error && <div className="an-error">{error}</div>}

      {data && (
        <>
          <div className="an-tiles">
            <div className="admin-card an-tile">
              <div className="an-tile-label">Page views</div>
              <div className="an-tile-value">{fmt(data.totals.views)}</div>
            </div>
            <div className="admin-card an-tile">
              <div className="an-tile-label">Daily visitors, summed</div>
              <div className="an-tile-value">{fmt(data.totals.visitors)}</div>
            </div>
            <div className="admin-card an-tile">
              <div className="an-tile-label">Views per day</div>
              <div className="an-tile-value">{fmt(Math.round(data.totals.views / data.days))}</div>
            </div>
          </div>

          <div className="admin-card">
            <div className="admin-card-header">
              <h2 className="admin-card-title">{data.from} to {data.to} (UTC)</h2>
              <div className="an-legend">
                <span><i className="an-key an-key-views" /> Views</span>
                <span><i className="an-key an-key-visitors" /> Visitors</span>
              </div>
            </div>
            <Chart series={data.series} />
          </div>

          <div className="an-columns">
            <div className="admin-card">
              <div className="admin-card-header"><h2 className="admin-card-title">Top pages</h2></div>
              {data.top_paths.length === 0 ? <p className="an-muted">No page views yet.</p> : (
                <table className="admin-table">
                  <thead><tr><th>Path</th><th className="an-num">Views</th><th className="an-num">Visitors</th></tr></thead>
                  <tbody>
                    {data.top_paths.map((row) => (
                      <tr key={row.path}>
                        <td className="an-path">{row.path}</td>
                        <td className="an-num">{fmt(row.views)}</td>
                        <td className="an-num">{fmt(row.visitors)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="admin-card">
              <div className="admin-card-header"><h2 className="admin-card-title">Top referrers</h2></div>
              {data.top_referrers.length === 0 ? <p className="an-muted">No referred visits yet.</p> : (
                <table className="admin-table">
                  <thead><tr><th>Domain</th><th className="an-num">Views</th></tr></thead>
                  <tbody>
                    {data.top_referrers.map((row) => (
                      <tr key={row.domain}>
                        <td className="an-path">{row.domain}</td>
                        <td className="an-num">{fmt(row.views)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}

      <div className="admin-card">
        <div className="admin-card-header"><h2 className="admin-card-title">How this is counted</h2></div>
        <div className="an-body">
          <p>
            No cookies, no stored IP addresses or user agents. A visitor is a hash of their address, browser and a
            random salt that changes every UTC day and is then deleted, so nobody — including you — can tell who
            visited, or link one day's visitors to the next. Browsers sending Do Not Track or Global Privacy
            Control are not counted at all, and neither are known bots.
          </p>
          <p className="an-muted">
            Your front end reports page views with a short snippet: <code>POST /api/v1/analytics/hit</code>.
            See <code>docs/analytics.md</code>.
          </p>
        </div>

        {mayConfigure && settings && (
          <form className="an-settings" onSubmit={save}>
            <label className="an-check">
              <input
                type="checkbox"
                checked={settings.analytics_enabled}
                onChange={(e) => setSettings({ ...settings, analytics_enabled: e.target.checked })}
              />
              Count page views
            </label>
            <label>
              Forget visitor hashes after (hours, 1–24)
              <input
                className="admin-input"
                type="number"
                min={1}
                max={24}
                value={settings.analytics_dedup_hours}
                onChange={(e) => setSettings({ ...settings, analytics_dedup_hours: Number(e.target.value) })}
              />
            </label>
            <label>
              Keep daily counts for (days, 0 = forever)
              <input
                className="admin-input"
                type="number"
                min={0}
                max={3650}
                value={settings.analytics_retention_days}
                onChange={(e) => setSettings({ ...settings, analytics_retention_days: Number(e.target.value) })}
              />
            </label>
            <div className="an-save">
              <button type="submit" className="admin-btn admin-btn-primary">Save</button>
              {saved && <span className="an-muted">{saved}</span>}
            </div>
          </form>
        )}
      </div>
    </AdminLayout>
  )
}

/**
 * Views as bars, visitors as a line, in plain SVG.
 *
 * A fixed coordinate space scaled to the card's width keeps the labels
 * undistorted; each bar carries a <title>, which is the tooltip and the
 * accessible text for the value.
 */
function Chart({ series }: { series: Day[] }) {
  const W = 720
  const H = 220
  const pad = { top: 12, right: 8, bottom: 24, left: 40 }
  const innerW = W - pad.left - pad.right
  const innerH = H - pad.top - pad.bottom
  const max = Math.max(1, ...series.map((d) => d.views))
  const step = innerW / Math.max(1, series.length)
  const barW = Math.max(1, step * 0.7)
  const y = (v: number) => pad.top + innerH - (v / max) * innerH

  const line = series
    .map((d, i) => `${(pad.left + i * step + step / 2).toFixed(1)},${y(d.visitors).toFixed(1)}`)
    .join(' ')

  const labelEvery = Math.ceil(series.length / 6)

  return (
    <svg className="an-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Views and visitors per day">
      <line x1={pad.left} x2={W - pad.right} y1={pad.top + innerH} y2={pad.top + innerH} className="an-axis" />
      <line x1={pad.left} x2={W - pad.right} y1={pad.top} y2={pad.top} className="an-grid" />
      <text x={pad.left - 6} y={pad.top + 4} textAnchor="end" className="an-label">{fmt(max)}</text>
      <text x={pad.left - 6} y={pad.top + innerH} textAnchor="end" className="an-label">0</text>

      {series.map((d, i) => (
        <rect
          key={d.day}
          x={pad.left + i * step + (step - barW) / 2}
          y={y(d.views)}
          width={barW}
          height={pad.top + innerH - y(d.views)}
          className="an-bar"
        >
          <title>{`${d.day}: ${fmt(d.views)} views, ${fmt(d.visitors)} visitors`}</title>
        </rect>
      ))}

      <polyline points={line} className="an-line" />

      {series.map((d, i) => (i % labelEvery === 0 || i === series.length - 1) && (
        <text key={`l-${d.day}`} x={pad.left + i * step + step / 2} y={H - 6} textAnchor="middle" className="an-label">
          {d.day.slice(5)}
        </text>
      ))}
    </svg>
  )
}

const analyticsStyles = `
  .an-toolbar { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
  .an-error {
    padding: 10px 14px; border-radius: 8px; border: 1px solid var(--danger);
    background: var(--tint-danger); color: var(--danger); font-size: 13px; margin-bottom: 16px;
  }
  .an-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }
  .an-tile-label { color: var(--fg-muted); font-size: 13px; }
  .an-tile-value { font-size: 28px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .an-legend { display: flex; gap: 14px; font-size: 13px; color: var(--fg-muted); }
  .an-key { display: inline-block; width: 10px; height: 10px; border-radius: 2px; vertical-align: middle; }
  .an-key-views { background: var(--accent); opacity: 0.55; }
  .an-key-visitors { background: var(--fg); height: 2px; }
  .an-chart { width: 100%; height: auto; display: block; }
  .an-bar { fill: var(--accent); opacity: 0.55; }
  .an-bar:hover { opacity: 0.85; }
  .an-line { fill: none; stroke: var(--fg); stroke-width: 1.5; }
  .an-axis { stroke: var(--border-strong); }
  .an-grid { stroke: var(--border); stroke-dasharray: 3 3; }
  .an-label { fill: var(--fg-muted); font-size: 11px; }
  .an-columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
  .an-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .an-path { overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .an-muted { color: var(--fg-muted); font-size: 13px; }
  .an-body { font-size: 14px; display: flex; flex-direction: column; gap: 8px; }
  .an-body p { margin: 0; }
  .an-body code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
    background: var(--surface-hover); border-radius: 4px; padding: 1px 4px;
  }
  .an-settings {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;
    margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border); font-size: 13px; align-items: end;
  }
  .an-settings label { display: flex; flex-direction: column; gap: 6px; }
  .an-settings .an-check { flex-direction: row; align-items: center; gap: 8px; }
  .an-save { display: flex; align-items: center; gap: 10px; }
`
