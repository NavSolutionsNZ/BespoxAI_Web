'use client'

/**
 * Schedule and track BCAgent full object exports (upgrade readiness).
 * Out of hours = 22:00–05:00 in the customer's time zone; any other time asks
 * for confirmation first. Failed or stale exports show the reason and a Retry.
 */

import { useEffect, useRef, useState } from 'react'
import { PALETTES, labelStyle, inputStyle, buttonStyle, noteStyle, type PanelVariant, type Palette } from './palette'

interface Job {
  id: string
  status: string
  notBefore: string
  outOfHours: boolean
  startedAt: string | null
  finishedAt: string | null
  error: string | null
  finsqlLog: string | null
  restoreVerified: boolean | null
  matchConfidence: string | null
  summary: any
  repoOwner: string | null
  repoName: string | null
  exportCommit: string | null
  createdAt: string
}

interface ListResponse {
  jobs: Job[]
  licence: { owner: string; problem: string | null; fileName: string | null }
  timeZone: string
  outOfHours: { startHour: number; endHour: number }
  ready: boolean
}

const ACTIVE = ['scheduled', 'running', 'uploaded', 'processing']

const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Scheduled', running: 'Exporting', uploaded: 'Uploaded', processing: 'Analysing',
  complete: 'Complete', failed: 'Failed', stale: 'No response',
}

function fmtInZone(iso: string | null, tz: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-NZ', {
    timeZone: tz, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

function hourInZone(d: Date, tz: string): number {
  return parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(d), 10) % 24
}

/** Next 22:30 in the customer's zone, as a value for <input type="datetime-local"> in the browser's zone. */
function defaultStart(tz: string): string {
  const now = new Date()
  let t = new Date(now.getTime() + 15 * 60 * 1000)
  for (let i = 0; i < 48 * 4; i++) {
    const h = hourInZone(t, tz)
    const m = parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: tz, minute: '2-digit' }).format(t), 10)
    if (h === 22 && m >= 30 && m < 45) break
    t = new Date(t.getTime() + 15 * 60 * 1000)
  }
  t.setSeconds(0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()) + 'T' + pad(t.getHours()) + ':' + pad(t.getMinutes())
}

function statusColour(p: Palette, s: string): string {
  if (s === 'complete') return p.success
  if (s === 'failed' || s === 'stale') return p.danger
  return p.accent
}

function ResultSummary({ p, job }: { p: Palette; job: Job }) {
  const s = job.summary
  if (!s) return null
  const o = s.byOrigin ?? {}
  const e = s.byEffort ?? {}
  const corpus = s.corpus ? s.corpus.version + ' ' + s.corpus.localisation + ' ' + s.corpus.build : ''
  const items: Array<[string, number]> = [
    ['Unmodified', o.standard_unmodified ?? 0], ['Modified standard', o.standard_modified ?? 0],
    ['Custom', o.custom_new ?? 0], ['ISV / unknown', o.isv_or_unknown ?? 0],
  ]
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontFamily: 'var(--font-body)', fontSize: 12, color: p.text }}>
        {items.map(([label, n]) => (
          <span key={label}><strong>{n}</strong>{' ' + label}</span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontFamily: 'var(--font-body)', fontSize: 12, color: p.muted, marginTop: 4 }}>
        <span>{'Effort — high ' + (e.high ?? 0) + ' · medium ' + (e.medium ?? 0) + ' · low ' + (e.low ?? 0)}</span>
        {corpus ? <span>{'Compared with ' + corpus + ' (' + (job.matchConfidence ?? '?') + ' confidence)'}</span> : null}
        {s.unattributed ? <span>{s.unattributed + ' modified without a version tag'}</span> : null}
        {s.noChanges ? <span>No changes since the last export</span> : null}
      </div>
    </div>
  )
}

function JobRow({ p, job, tz, onRetry }: { p: Palette; job: Job; tz: string; onRetry: () => void }) {
  const canRetry = job.status === 'failed' || job.status === 'stale'
  return (
    <div style={{ borderTop: '1px solid ' + p.border, padding: '12px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: statusColour(p, job.status), border: '1px solid ' + statusColour(p, job.status), borderRadius: 10, padding: '2px 8px' }}>
            {STATUS_LABEL[job.status] ?? job.status}
          </span>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: p.text }}>{'Start ' + fmtInZone(job.notBefore, tz)}</span>
          {!job.outOfHours ? <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: p.warning }}>inside business hours</span> : null}
          {job.finishedAt ? <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: p.muted }}>{'Finished ' + fmtInZone(job.finishedAt, tz)}</span> : null}
        </div>
        {canRetry ? <button type="button" onClick={onRetry} style={buttonStyle(p, 'ghost')}>Retry</button> : null}
      </div>

      {job.restoreVerified === false ? (
        <div style={{ ...noteStyle(p, 'danger'), marginTop: 8 }}>
          BCAgent could not confirm the customer's own licence was restored. Check the database licence on the server now.
        </div>
      ) : null}

      {job.error ? (
        <div style={{ ...noteStyle(p, job.status === 'complete' ? 'warning' : 'danger'), marginTop: 8 }}>{job.error}</div>
      ) : null}

      {job.status === 'complete' ? <ResultSummary p={p} job={job} /> : null}

      {job.exportCommit && job.repoOwner && job.repoName ? (
        <a
          href={'https://github.com/' + job.repoOwner + '/' + job.repoName + '/commit/' + job.exportCommit}
          target="_blank" rel="noreferrer"
          style={{ display: 'inline-block', marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 11, color: p.accent }}
        >
          {'View changed objects on GitHub (' + job.exportCommit.slice(0, 7) + ')'}
        </a>
      ) : null}

      {job.finsqlLog ? (
        <details style={{ marginTop: 6 }}>
          <summary style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: p.muted, cursor: 'pointer' }}>finsql log</summary>
          <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: p.text, background: p.inset, padding: 10, borderRadius: 6, whiteSpace: 'pre-wrap', maxHeight: 240, overflowY: 'auto' }}>{job.finsqlLog}</pre>
        </details>
      ) : null}
    </div>
  )
}

export default function ObjectExportsPanel({ apiUrl, canSchedule, variant }: {
  apiUrl: string
  canSchedule: boolean
  variant: PanelVariant
}) {
  const p = PALETTES[variant]
  const startRef = useRef<HTMLInputElement>(null)
  const [data, setData] = useState<ListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [scheduled, setScheduled] = useState(false)

  async function load() {
    try {
      const r = await fetch(apiUrl)
      const d = await r.json()
      if (r.ok) setData(d)
      else setError(d.error ?? 'Could not load exports')
    } catch { setError('Network error') }
    setLoading(false)
  }

  useEffect(() => { load() }, [apiUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  // Poll while an export is in flight
  const hasActive = !!data?.jobs.some(j => ACTIVE.includes(j.status))
  useEffect(() => {
    if (!hasActive) return
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [hasActive]) // eslint-disable-line react-hooks/exhaustive-deps

  async function schedule(confirmInHours: boolean) {
    const v = startRef.current?.value
    if (!v) { setError('Choose a start time.'); return }
    setBusy(true); setError(null); setScheduled(false)
    try {
      const r = await fetch(apiUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notBefore: new Date(v).toISOString(), confirmInHours }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.status === 409 && d.needsConfirm) setConfirm(d.error)
      else if (!r.ok) { setError(d.error ?? 'Could not schedule the export'); setConfirm(null) }
      else { setConfirm(null); setScheduled(true); await load() }
    } catch { setError('Network error') }
    setBusy(false)
  }

  function retry() {
    if (startRef.current && data) startRef.current.value = defaultStart(data.timeZone)
    setError(null); setConfirm(null)
    startRef.current?.focus()
  }

  if (loading) return <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: p.muted }}>Loading…</p>
  if (!data) return <div style={noteStyle(p, 'danger')}>{error ?? 'Could not load exports'}</div>

  const tz = data.timeZone
  const active = data.jobs.find(j => ACTIVE.includes(j.status))
  const blocked = !data.ready ? 'Set up the BCAgent tunnel and NAV database name first.'
    : data.licence.problem ? data.licence.problem + (data.licence.owner === 'partner' ? ' Upload it under Settings → Developer licence.' : ' Upload Nav Solutions\' licence under Business → Developer licence.')
    : null

  return (
    <div>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: p.muted, margin: '0 0 14px' }}>
        {'Exports every application object from the customer\'s database and compares it with the standard ' +
          'base version to find what has been modified, what is custom, and how each item maps to AL. The export ' +
          'briefly applies the developer licence to this database and loads the SQL server, so run it out of hours (' +
          data.outOfHours.startHour + ':00–0' + data.outOfHours.endHour + ':00 ' + tz + ').'}
      </p>

      {blocked ? <div style={{ ...noteStyle(p, 'warning'), marginBottom: 14 }}>{blocked}</div> : null}

      {canSchedule && !blocked && !active ? (
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 220 }}>
              <label style={labelStyle(p)}>Start time (your local time)</label>
              <input ref={startRef} type="datetime-local" defaultValue={defaultStart(tz)} style={inputStyle(p)} onChange={() => setConfirm(null)} />
            </div>
            <button type="button" disabled={busy} onClick={() => schedule(false)} style={buttonStyle(p, 'primary', busy)}>
              {busy ? 'Scheduling…' : 'Schedule export'}
            </button>
          </div>
          {confirm ? (
            <div style={{ ...noteStyle(p, 'warning'), marginTop: 12 }}>
              <div style={{ marginBottom: 10 }}>{confirm}</div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" disabled={busy} onClick={() => schedule(true)} style={buttonStyle(p, 'primary', busy)}>Schedule anyway</button>
                <button type="button" onClick={() => setConfirm(null)} style={buttonStyle(p, 'ghost')}>Pick another time</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {!canSchedule && !active ? (
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: p.muted }}>Only admins can schedule an export — it uses the developer licence.</p>
      ) : null}

      {error ? <div style={{ ...noteStyle(p, 'danger'), marginBottom: 14 }}>{error}</div> : null}
      {scheduled ? <div style={{ ...noteStyle(p, 'success'), marginBottom: 14 }}>Export scheduled. BCAgent will run it at the chosen time.</div> : null}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: p.muted }}>History</span>
        <button type="button" onClick={load} style={{ ...buttonStyle(p, 'ghost'), padding: '4px 10px', fontSize: 12 }}>Refresh</button>
      </div>
      {data.jobs.length === 0 ? (
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: p.muted }}>No exports yet.</p>
      ) : (
        <div>
          {data.jobs.map(j => <JobRow key={j.id} p={p} job={j} tz={tz} onRetry={retry} />)}
        </div>
      )}
    </div>
  )
}
