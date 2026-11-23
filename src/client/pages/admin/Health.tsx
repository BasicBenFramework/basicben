import React, { useEffect, useState } from 'react'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'

type Status = 'pass' | 'warn' | 'fail'

interface Check {
  id: string
  label: string
  status: Status
  message: string
  hint: string
}

interface HealthReport {
  status: Status
  generated_at: string
  environment: { node_env: string | null; serverless: boolean }
  checks: Check[]
}

interface ProbeResult {
  ok: boolean
  driver: string | null
  steps: Array<{ step: string; ok: boolean; ms: number; error?: string }>
}

const LABEL: Record<Status, string> = { pass: 'OK', warn: 'Warning', fail: 'Problem' }
const ORDER: Record<Status, number> = { fail: 0, warn: 1, pass: 2 }

/**
 * Site health: what this deployment is configured to do, and what it should
 * fix before people rely on it.
 *
 * Every check is computed on the server (helpers/health.ts) — the browser
 * cannot see the environment, and should not: the server reports whether a
 * secret is set and how long it is, never what it is. The two actions that
 * touch the outside world, the storage probe and the test email, are buttons
 * rather than part of the page load, because each one writes something.
 */
export default function AdminHealth() {
  const [report, setReport] = useState<HealthReport | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  const [probing, setProbing] = useState(false)
  const [mail, setMail] = useState<string>('')
  const [mailing, setMailing] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setReport(await api.get<HealthReport>('/api/admin/health'))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const runProbe = async () => {
    setProbing(true)
    try {
      setProbe(await api.post<ProbeResult>('/api/admin/health/storage-probe'))
    } catch (err) {
      setProbe({ ok: false, driver: null, steps: [{ step: 'request', ok: false, ms: 0, error: (err as Error).message }] })
    } finally {
      setProbing(false)
    }
  }

  const sendTest = async () => {
    setMailing(true)
    try {
      const res = await api.post<{ to: string; note: string | null }>('/api/admin/health/test-email')
      setMail(res.note ? res.note : `Sent to ${res.to}. Check that inbox (and its spam folder).`)
    } catch (err) {
      setMail(`Not sent: ${(err as Error).message}`)
    } finally {
      setMailing(false)
    }
  }

  // Worst first, so what needs doing is at the top; stable within a status.
  const checks = [...(report?.checks ?? [])].sort((a, b) => ORDER[a.status] - ORDER[b.status])
  const counts = { fail: 0, warn: 0, pass: 0 }
  for (const c of checks) counts[c.status]++

  return (
    <AdminLayout title="Site health">
      <style>{healthStyles}</style>

      {error && <div className="health-banner health-fail">{error}</div>}

      {report && (
        <div className={`health-banner health-${report.status}`}>
          <strong>
            {report.status === 'pass' ? 'Everything checks out.' : report.status === 'warn' ? 'Working, with things to look at.' : 'Something needs fixing.'}
          </strong>{' '}
          {counts.fail} problem(s), {counts.warn} warning(s), {counts.pass} OK.
          <span className="health-muted">
            {' '}NODE_ENV {report.environment.node_env ?? 'unset'}{report.environment.serverless ? ', serverless' : ''} ·
            checked {new Date(report.generated_at).toLocaleTimeString()}
          </span>
          <button type="button" className="admin-btn admin-btn-secondary health-refresh" onClick={load} disabled={loading}>
            {loading ? 'Checking…' : 'Re-check'}
          </button>
        </div>
      )}

      {loading && !report && <div className="admin-card">Checking…</div>}

      {checks.length > 0 && (
        <div className="admin-card">
          <ul className="health-list">
            {checks.map((c) => (
              <li key={c.id} className="health-item">
                <span className={`health-pill health-pill-${c.status}`}>{LABEL[c.status]}</span>
                <div>
                  <div className="health-label">{c.label}</div>
                  <div className="health-message">{c.message}</div>
                  {c.hint && <div className="health-hint">{c.hint}</div>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="admin-card">
        <div className="admin-card-header">
          <h2 className="admin-card-title">Live checks</h2>
        </div>
        <div className="health-actions">
          <div>
            <p>
              <strong>Storage probe.</strong> Writes a small file under <code>health-probe/</code>, reads it
              back and deletes it, using the same credentials uploads use.
            </p>
            <button type="button" className="admin-btn admin-btn-secondary" onClick={runProbe} disabled={probing}>
              {probing ? 'Probing…' : 'Run storage probe'}
            </button>
            {probe && (
              <ul className="health-steps">
                {probe.steps.map((s) => (
                  <li key={s.step} className={s.ok ? 'health-ok' : 'health-bad'}>
                    {s.step}: {s.ok ? `ok (${s.ms} ms)` : s.error}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p>
              <strong>Test email.</strong> Sends a short message to your own account's address — never to any other.
            </p>
            <button type="button" className="admin-btn admin-btn-secondary" onClick={sendTest} disabled={mailing}>
              {mailing ? 'Sending…' : 'Send test email to me'}
            </button>
            {mail && <p className="health-muted">{mail}</p>}
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}

const healthStyles = `
  .health-banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 12px 16px;
    border-radius: 8px;
    border: 1px solid var(--border);
    margin-bottom: 16px;
    font-size: 14px;
  }
  .health-pass { border-color: var(--success); background: var(--tint-success); }
  .health-warn { border-color: var(--warning); background: var(--tint-warning); }
  .health-fail { border-color: var(--danger); background: var(--tint-danger); }
  .health-refresh { margin-left: auto; }
  .health-muted { color: var(--fg-muted); font-size: 13px; }

  .health-list { list-style: none; margin: 0; padding: 0; }
  .health-item {
    display: grid;
    grid-template-columns: 84px 1fr;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
    font-size: 14px;
  }
  .health-item:last-child { border-bottom: 0; }
  .health-label { font-weight: 600; }
  .health-message { color: var(--fg); overflow-wrap: anywhere; }
  .health-hint { color: var(--fg-muted); font-size: 13px; margin-top: 4px; overflow-wrap: anywhere; }

  .health-pill {
    align-self: start;
    text-align: center;
    font-size: 12px;
    font-weight: 600;
    border-radius: 999px;
    padding: 2px 8px;
    border: 1px solid currentColor;
  }
  .health-pill-pass { color: var(--success); }
  .health-pill-warn { color: var(--warning); }
  .health-pill-fail { color: var(--danger); }

  .health-actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 24px;
    font-size: 14px;
  }
  .health-actions p { margin: 0 0 8px; }
  .health-actions code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    background: var(--surface-hover);
    border-radius: 4px;
    padding: 1px 4px;
  }
  .health-steps { margin: 8px 0 0; padding-left: 18px; font-size: 13px; }
  .health-ok { color: var(--success); }
  .health-bad { color: var(--danger); overflow-wrap: anywhere; }

  @media (max-width: 600px) {
    .health-item { grid-template-columns: 1fr; gap: 4px; }
    .health-pill { justify-self: start; }
  }
`
