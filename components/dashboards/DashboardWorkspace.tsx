'use client'

import { useEffect, useState } from 'react'
import DashboardRenderer, { type DashboardSourceMode } from './DashboardRenderer'
import { METRICS } from '@/lib/dashboards/registry'
import {
  TYPES_FOR_KIND, addSection, addWidget, moveWidget, removeSection, removeWidget,
  renameSection, tidy, updateWidget,
} from '@/lib/dashboards/edit'
import type { CompareKey, DashboardSpec, PeriodKey, WidgetSpec } from '@/lib/dashboards/types'

// ─── Types ───────────────────────────────────────────────────────────────────

interface SavedDashboard {
  id: string
  name: string
  spec: DashboardSpec
  sharedWithTenant: boolean
  isHome: boolean
  isMine: boolean
  ownerName?: string
}

interface ListResponse {
  default: { name: string; spec: DashboardSpec }
  mine: SavedDashboard[]
  shared: SavedDashboard[]
}

const DEFAULT_KEY = '__default__'

const PERIOD_LABELS: Record<PeriodKey, string> = {
  this_month: 'This month', last_month: 'Last month', this_quarter: 'This quarter',
  last_quarter: 'Last quarter', ytd: 'Year to date', last_year: 'Last year',
  last_12_months: 'Last 12 months', as_at_today: 'As at today',
}
const COMPARE_LABELS: Record<CompareKey, string> = { none: 'No comparison', prior_period: 'vs prior period', prior_year: 'vs prior year' }
const TYPE_LABELS: Record<string, string> = { kpi: 'Tile', line: 'Line chart', bar: 'Bar chart', table: 'Table' }
const PERIOD_KEYS = Object.keys(PERIOD_LABELS).filter(k => k !== 'as_at_today') as PeriodKey[]

// ─── Styles ──────────────────────────────────────────────────────────────────

const btn = {
  fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em', padding: '7px 12px',
  borderRadius: 6, border: '1px solid var(--fog)', background: 'var(--white)', color: 'var(--ink)', cursor: 'pointer',
}
const btnPrimary = { ...btn, background: 'var(--forest)', borderColor: 'var(--forest)', color: '#fff' }
const btnDanger = { ...btn, color: '#B4442E' }
const input = { fontSize: 13, padding: '6px 8px', border: '1px solid var(--fog)', borderRadius: 6, background: 'var(--white)', color: 'var(--ink)' }
const small = { ...input, fontSize: 12, padding: '4px 6px' }
const iconBtn = { ...btn, padding: '4px 8px' }

// ─── API ─────────────────────────────────────────────────────────────────────

function withTenant(url: string, tenantId?: string): string {
  return tenantId ? url + (url.includes('?') ? '&' : '?') + 'tenantId=' + encodeURIComponent(tenantId) : url
}

async function api(method: string, url: string, tenantId?: string, body?: Record<string, unknown>) {
  const res = await fetch(withTenant(url, tenantId), {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify({ ...body, tenantId }) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = Array.isArray(data?.errors) ? ': ' + data.errors.join('; ') : ''
    throw new Error((data?.message ?? data?.error ?? 'Request failed') + detail)
  }
  return data
}

// ─── Editor pieces ───────────────────────────────────────────────────────────

function WidgetEditorRow({ w, onChange, onMove, onRemove }: {
  w: WidgetSpec
  onChange: (patch: Partial<Omit<WidgetSpec, 'id' | 'metricId'>>) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
}) {
  const def = METRICS[w.metricId]
  const params = { ...def.defaultParams, ...(w.params ?? {}) }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--fog)' }}>
      <input style={{ ...small, flex: '1 1 180px' }} value={w.title} maxLength={80} onChange={e => onChange({ title: e.target.value })} aria-label="Widget title" />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--slate)', minWidth: 110 }}>{def.label}</span>
      {def.acceptsPeriod ? (
        <select style={small} value={params.period} onChange={e => onChange({ params: { period: e.target.value as PeriodKey } })} aria-label="Period">
          {PERIOD_KEYS.map(k => <option key={k} value={k}>{PERIOD_LABELS[k]}</option>)}
        </select>
      ) : null}
      {def.acceptsCompare ? (
        <select style={small} value={params.compare ?? 'none'} onChange={e => onChange({ params: { compare: e.target.value as CompareKey } })} aria-label="Comparison">
          {(Object.keys(COMPARE_LABELS) as CompareKey[]).map(k => <option key={k} value={k}>{COMPARE_LABELS[k]}</option>)}
        </select>
      ) : null}
      {TYPES_FOR_KIND[def.kind].length > 1 ? (
        <select style={small} value={w.type} onChange={e => onChange({ type: e.target.value as WidgetSpec['type'] })} aria-label="Display">
          {TYPES_FOR_KIND[def.kind].map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
        </select>
      ) : null}
      <select style={small} value={w.width} onChange={e => onChange({ width: Number(e.target.value) as WidgetSpec['width'] })} aria-label="Width">
        <option value={3}>¼ width</option>
        <option value={4}>⅓ width</option>
        <option value={6}>½ width</option>
        <option value={8}>⅔ width</option>
        <option value={12}>Full width</option>
      </select>
      <button style={iconBtn} onClick={() => onMove(-1)} aria-label="Move up">↑</button>
      <button style={iconBtn} onClick={() => onMove(1)} aria-label="Move down">↓</button>
      <button style={{ ...iconBtn, color: '#B4442E' }} onClick={onRemove} aria-label="Remove widget">✕</button>
    </div>
  )
}

function SpecEditor({ spec, onChange }: { spec: DashboardSpec; onChange: (s: DashboardSpec) => void }) {
  const [newSection, setNewSection] = useState('')
  const metricIds = Object.keys(METRICS)
  return (
    <div style={{ background: 'var(--white)', border: '1px solid var(--fog)', borderRadius: 10, padding: 16, marginBottom: 24 }}>
      <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 4 }}>
        Dashboard name
      </label>
      <input style={{ ...input, width: '100%', maxWidth: 420, marginBottom: 16 }} value={spec.name} maxLength={80} onChange={e => onChange({ ...spec, name: e.target.value })} />
      {spec.sections.map(sec => (
        <div key={sec.id} style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
            <input style={{ ...input, fontWeight: 600, flex: '1 1 auto', maxWidth: 360 }} value={sec.title} maxLength={80} onChange={e => onChange(renameSection(spec, sec.id, e.target.value))} aria-label="Section title" />
            <button style={btnDanger} onClick={() => onChange(removeSection(spec, sec.id))}>Remove section</button>
          </div>
          {sec.widgets.map(w => (
            <WidgetEditorRow
              key={w.id} w={w}
              onChange={patch => onChange(updateWidget(spec, w.id, patch))}
              onMove={dir => onChange(moveWidget(spec, w.id, dir))}
              onRemove={() => onChange(removeWidget(spec, w.id))}
            />
          ))}
          <div style={{ paddingTop: 8 }}>
            <select
              style={small} value=""
              onChange={e => { if (e.target.value) onChange(addWidget(spec, sec.id, e.target.value)) }}
              aria-label="Add widget"
            >
              <option value="">+ Add widget…</option>
              {metricIds.map(id => <option key={id} value={id}>{METRICS[id].label + ' — ' + METRICS[id].description}</option>)}
            </select>
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input style={input} placeholder="New section title" value={newSection} maxLength={80} onChange={e => setNewSection(e.target.value)} />
        <button style={btn} onClick={() => { onChange(addSection(spec, newSection.trim())); setNewSection('') }}>Add section</button>
      </div>
    </div>
  )
}

function pickInitial(list: ListResponse): string {
  const home = list.mine.find(d => d.isHome)
  return home ? home.id : DEFAULT_KEY
}

// ─── Workspace ───────────────────────────────────────────────────────────────

export default function DashboardWorkspace({ source, tenantId }: { source: DashboardSourceMode; tenantId?: string }) {
  const [list, setList] = useState<ListResponse | null>(null)
  const [selected, setSelected] = useState<string>(DEFAULT_KEY)
  const [draft, setDraft] = useState<DashboardSpec | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function reload(selectId?: string) {
    const data: ListResponse = await api('GET', '/api/dashboards', tenantId)
    setList(data)
    setSelected(selectId ?? pickInitial(data))
  }

  useEffect(() => {
    reload().catch(e => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId])

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError('')
    try { await fn() } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }

  if (!list) {
    return error ? <div style={{ color: '#B4442E', fontSize: 13 }}>{error}</div> : <div style={{ fontSize: 13, color: 'var(--slate)' }}>Loading dashboards…</div>
  }

  const current: SavedDashboard | null = list.mine.concat(list.shared).find(d => d.id === selected) ?? null
  const viewing: DashboardSpec = current ? current.spec : list.default.spec
  const isDefault = !current
  const isMine = !!current && current.isMine
  const hasHome = list.mine.some(d => d.isHome)

  function save() {
    if (!draft) return
    const spec = tidy(draft)
    return run(async () => {
      if (isMine && current) {
        await api('PUT', '/api/dashboards/' + current.id, tenantId, { name: spec.name, spec })
        await reload(current.id)
      } else {
        const res = await api('POST', '/api/dashboards', tenantId, { name: spec.name, spec, isHome: !hasHome })
        await reload(res.dashboard.id)
      }
      setDraft(null)
    })
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        <select
          style={{ ...input, minWidth: 240 }} value={selected} disabled={!!draft}
          onChange={e => setSelected(e.target.value)} aria-label="Choose dashboard"
        >
          <option value={DEFAULT_KEY}>{list.default.name + ' (default)'}</option>
          {list.mine.length ? (
            <optgroup label="My dashboards">
              {list.mine.map(d => <option key={d.id} value={d.id}>{(d.isHome ? '★ ' : '') + d.name + (d.sharedWithTenant ? ' · shared' : '')}</option>)}
            </optgroup>
          ) : null}
          {list.shared.length ? (
            <optgroup label="Shared with me">
              {list.shared.map(d => <option key={d.id} value={d.id}>{d.name + ' — ' + (d.ownerName ?? 'colleague')}</option>)}
            </optgroup>
          ) : null}
        </select>

        {draft ? (
          <>
            <button style={btnPrimary} disabled={busy} onClick={save}>{isMine ? 'Save changes' : 'Save as my dashboard'}</button>
            <button style={btn} disabled={busy} onClick={() => { setDraft(null); setError('') }}>Cancel</button>
          </>
        ) : (
          <>
            {isDefault ? <button style={btnPrimary} onClick={() => setDraft(JSON.parse(JSON.stringify(viewing)))}>Customise</button> : null}
            {isMine ? <button style={btn} onClick={() => setDraft(JSON.parse(JSON.stringify(viewing)))}>Edit</button> : null}
            {current && !isMine ? (
              <button style={btnPrimary} disabled={busy} onClick={() => run(async () => {
                const res = await api('POST', '/api/dashboards', tenantId, { cloneFromId: current.id, name: current.name + ' (copy)' })
                await reload(res.dashboard.id)
              })}>Make a copy</button>
            ) : null}
            {isMine && current && !current.isHome ? (
              <button style={btn} disabled={busy} onClick={() => run(async () => {
                await api('PUT', '/api/dashboards/' + current.id, tenantId, { isHome: true }); await reload(current.id)
              })}>Make home</button>
            ) : null}
            {isMine && current ? (
              <button style={btn} disabled={busy} onClick={() => run(async () => {
                await api('PUT', '/api/dashboards/' + current.id, tenantId, { sharedWithTenant: !current.sharedWithTenant }); await reload(current.id)
              })}>{current.sharedWithTenant ? 'Stop sharing' : 'Share with my organisation'}</button>
            ) : null}
            {isMine && current ? (
              <button style={btnDanger} disabled={busy} onClick={() => {
                const msg = current.isHome
                  ? 'Delete "' + current.name + '"? Your home will go back to the default dashboard.'
                  : 'Delete "' + current.name + '"?'
                if (window.confirm(msg)) run(async () => { await api('DELETE', '/api/dashboards/' + current.id, tenantId); await reload() })
              }}>{current.isHome ? 'Reset to default' : 'Delete'}</button>
            ) : null}
          </>
        )}
      </div>

      {current && !isMine && !draft ? (
        <p style={{ fontSize: 12, color: 'var(--slate)', margin: '0 0 16px' }}>
          {'Shared by ' + (current.ownerName ?? 'a colleague') + '. Make a copy to change it.'}
        </p>
      ) : null}
      {error ? <div style={{ color: '#B4442E', fontSize: 13, marginBottom: 12 }}>{error}</div> : null}
      {draft ? <SpecEditor spec={draft} onChange={setDraft} /> : null}

      <DashboardRenderer spec={draft ?? viewing} source={source} tenantId={tenantId} />
    </div>
  )
}
