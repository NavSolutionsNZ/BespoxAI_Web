'use client'

import { useEffect, useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import type { DashboardSpec, MetricResult, WidgetSpec } from '@/lib/dashboards/types'

// Colours match components/DataVisualizer.tsx so dashboards and chat charts read as one system.
const FOREST = '#1A5C46'
const JADE = '#1A9272'
const FOG = '#D6D9D4'
const SLATE = '#3B5249'
const RED = '#B4442E'

const tooltipStyle = {
  background: '#040E09', border: 'none', borderRadius: 8,
  fontFamily: 'var(--font-mono)', fontSize: 11, color: '#D6D9D4', padding: '8px 12px',
}

export type DashboardSourceMode = 'mock' | 'live'

interface WidgetState {
  loading: boolean
  result: MetricResult | null
  error: string
}

// ─── Formatting ──────────────────────────────────────────────────────────────

function money(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '−' : ''
  if (abs >= 1_000_000) return sign + '$' + (abs / 1_000_000).toFixed(2) + 'M'
  if (abs >= 10_000) return sign + '$' + Math.round(abs / 1000).toLocaleString('en-NZ') + 'k'
  return sign + '$' + Math.round(abs).toLocaleString('en-NZ')
}

function moneyFull(n: number): string {
  return (n < 0 ? '−$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-NZ')
}

function axisMoney(v: number): string {
  return money(v)
}

function deltaText(cur: number, prev: number): { text: string; good: boolean } | null {
  if (!prev) return null
  const pct = ((cur - prev) / Math.abs(prev)) * 100
  const arrow = pct >= 0 ? '▲ ' : '▼ '
  return { text: arrow + Math.abs(pct).toFixed(1) + '% vs ' + moneyFull(prev), good: pct >= 0 }
}

// ─── Widget bodies ───────────────────────────────────────────────────────────

function KpiBody({ result }: { result: MetricResult }) {
  const s = result.scalar
  if (!s) return null
  const d = s.compareValue !== undefined ? deltaText(s.value, s.compareValue) : null
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 32, color: 'var(--ink)', lineHeight: 1.05 }}>
        {moneyFull(s.value)}
      </div>
      {d ? (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, marginTop: 6, color: d.good ? JADE : RED, letterSpacing: '0.04em' }}>
          {d.text}
        </div>
      ) : null}
    </div>
  )
}

function LineBody({ result }: { result: MetricResult }) {
  const pts = result.series?.points ?? []
  return (
    <div style={{ width: '100%', height: 200 }}>
      <ResponsiveContainer>
        <LineChart data={pts} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={FOG} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: SLATE }} tickLine={false} axisLine={{ stroke: FOG }} />
          <YAxis tickFormatter={axisMoney} tick={{ fontSize: 10, fill: SLATE }} tickLine={false} axisLine={false} width={60} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => moneyFull(Number(v))} />
          <Line type="monotone" dataKey="value" stroke={FOREST} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function BarBody({ result }: { result: MetricResult }) {
  const rows = result.breakdown?.rows ?? result.series?.points ?? []
  const horizontal = rows.length > 6
  return (
    <div style={{ width: '100%', height: horizontal ? Math.max(200, rows.length * 26) : 200 }}>
      <ResponsiveContainer>
        {horizontal ? (
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={FOG} strokeDasharray="2 4" horizontal={false} />
            <XAxis type="number" tickFormatter={axisMoney} tick={{ fontSize: 10, fill: SLATE }} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fill: SLATE }} tickLine={false} axisLine={false} width={140} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => moneyFull(Number(v))} />
            <Bar dataKey="value" fill={FOREST} radius={[0, 3, 3, 0]} />
          </BarChart>
        ) : (
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={FOG} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: SLATE }} tickLine={false} axisLine={{ stroke: FOG }} />
            <YAxis tickFormatter={axisMoney} tick={{ fontSize: 10, fill: SLATE }} tickLine={false} axisLine={false} width={60} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => moneyFull(Number(v))} />
            <Bar dataKey="value" fill={FOREST} radius={[3, 3, 0, 0]} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

function TableBody({ result }: { result: MetricResult }) {
  const rows = result.breakdown?.rows ?? (result.series?.points ?? []).map(p => ({ label: p.label, value: p.value, extra: undefined }))
  const hasCompare = rows.some(r => r.extra && r.extra.compare !== undefined)
  const cell = { padding: '7px 10px', borderBottom: '1px solid var(--fog)', fontSize: 13 }
  const num = { ...cell, textAlign: 'right' as const, fontFamily: 'var(--font-mono)', fontSize: 12 }
  const head = { ...cell, fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--slate)' }
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ ...head, textAlign: 'left' }}>Line</th>
          <th style={{ ...head, textAlign: 'right' }}>{hasCompare ? 'This period' : 'Amount'}</th>
          {hasCompare ? <th style={{ ...head, textAlign: 'right' }}>Comparison</th> : null}
          {hasCompare ? <th style={{ ...head, textAlign: 'right' }}>Change</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map(r => {
          const prev = r.extra ? r.extra.compare : undefined
          return (
            <tr key={r.label}>
              <td style={cell}>{r.label}</td>
              <td style={num}>{moneyFull(r.value)}</td>
              {hasCompare ? <td style={num}>{prev !== undefined ? moneyFull(prev) : '—'}</td> : null}
              {hasCompare ? <td style={num}>{prev !== undefined ? moneyFull(r.value - prev) : '—'}</td> : null}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Provenance({ result }: { result: MetricResult }) {
  const p = result.provenance
  const line = { fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--slate)', lineHeight: 1.6 }
  return (
    <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--cream)', borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: 'var(--ink)', marginBottom: 6 }}>{p.method}</div>
      {p.period ? <div style={line}>{'Period: ' + p.period.from + ' to ' + p.period.to}</div> : null}
      {p.comparePeriod ? <div style={line}>{'Compared with: ' + p.comparePeriod.from + ' to ' + p.comparePeriod.to}</div> : null}
      {p.fiscalYear ? (
        <div style={line}>{p.fiscalYear === 'nav' ? 'Fiscal year: from NAV Accounting Periods' : 'Fiscal year: calendar year (NAV Accounting Periods not available)'}</div>
      ) : null}
      <div style={line}>{'Read ' + new Date(p.asOf).toLocaleString('en-NZ') + ' · ' + p.rowsRead + ' rows · source: ' + p.source}</div>
      {p.truncated ? <div style={{ ...line, color: RED }}>Row limit reached — figure may be incomplete.</div> : null}
      {p.calls.map((c, i) => (
        <div key={i} style={{ ...line, wordBreak: 'break-all', opacity: 0.8 }}>{c}</div>
      ))}
    </div>
  )
}

function WidgetBody({ widget, result }: { widget: WidgetSpec; result: MetricResult }) {
  if (widget.type === 'kpi') return <KpiBody result={result} />
  if (widget.type === 'line') return <LineBody result={result} />
  if (widget.type === 'bar') return <BarBody result={result} />
  return <TableBody result={result} />
}

async function loadMetric(widget: WidgetSpec, source: DashboardSourceMode, tenantId?: string): Promise<MetricResult> {
  const res = await fetch('/api/dashboards/metric', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ metricId: widget.metricId, params: widget.params, source, tenantId }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.message ?? data?.error ?? 'Failed to load')
  return data.result as MetricResult
}

// ─── Widget card ─────────────────────────────────────────────────────────────

function WidgetCard({ widget, source, tenantId }: { widget: WidgetSpec; source: DashboardSourceMode; tenantId?: string }) {
  const [state, setState] = useState<WidgetState>({ loading: true, result: null, error: '' })
  const [showSource, setShowSource] = useState(false)

  // Refetch only when what's fetched changes — not on title/width/type edits.
  const fetchKey = widget.metricId + '|' + JSON.stringify(widget.params ?? {})
  useEffect(() => {
    let alive = true
    setState({ loading: true, result: null, error: '' })
    loadMetric(widget, source, tenantId)
      .then(result => { if (alive) setState({ loading: false, result, error: '' }) })
      .catch(e => { if (alive) setState({ loading: false, result: null, error: e?.message ?? 'Failed' }) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey, source, tenantId])

  const span = 'span ' + widget.width
  return (
    <div className="bx-dash-w" style={{ gridColumn: span, background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 10, padding: '16px 18px', minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, gap: 8 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)' }}>
          {widget.title}
        </span>
        {state.result ? (
          <button
            onClick={() => setShowSource(!showSource)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 9, color: JADE, letterSpacing: '0.06em', padding: 0 }}
          >
            {showSource ? 'Hide source' : 'Source'}
          </button>
        ) : null}
      </div>
      {state.loading ? <div style={{ height: 48, borderRadius: 6, background: 'var(--parchment)', animation: 'pulse 1.5s infinite' }} /> : null}
      {state.error ? <div style={{ fontSize: 12, color: RED }}>{state.error}</div> : null}
      {state.result ? <WidgetBody widget={widget} result={state.result} /> : null}
      {state.result && showSource ? <Provenance result={state.result} /> : null}
    </div>
  )
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

// Phones: every widget takes the full row.
const GRID_CSS = '@media (max-width: 720px) { .bx-dash-w { grid-column: span 12 !important; } }'

export default function DashboardRenderer({ spec, source, tenantId }: { spec: DashboardSpec; source: DashboardSourceMode; tenantId?: string }) {
  return (
    <div>
      <style>{GRID_CSS}</style>
      {spec.sections.map(sec => (
        <section key={sec.id} style={{ marginBottom: 28 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 22, color: 'var(--ink)', margin: '0 0 12px' }}>
            {sec.title}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 12 }}>
            {sec.widgets.map(w => (
              <WidgetCard key={w.id} widget={w} source={source} tenantId={tenantId} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
