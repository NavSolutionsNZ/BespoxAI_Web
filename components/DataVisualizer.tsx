'use client'

import { useState } from 'react'
import {
  ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
  LineChart, Line,
} from 'recharts'
import type { DisplayHint, StructuredData } from '@/app/api/query/route'
import { isIdentifierHeader } from '@/lib/answer-format'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  displayHint: DisplayHint
  data: StructuredData | null
}

// ─── Colour tokens — match the dashboard palette ──────────────────────────────

const FOREST  = '#1A5C46'
const JADE    = '#1A9272'
const AMBER   = '#C8952A'
const FOG     = '#D6D9D4'
const INK     = '#040E09'
const SLATE   = '#3B5249'
const PARCHMENT = '#F5F4EF'
const WHITE   = '#FFFFFF'

// ─── Shared tooltip style ─────────────────────────────────────────────────────

const tooltipStyle = {
  background: INK,
  border: 'none',
  borderRadius: 8,
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: '#D6D9D4',
  padding: '8px 12px',
}

// ─── Number formatter ─────────────────────────────────────────────────────────

function fmt(value: string | number | null): string {
  if (value == null) return '—'
  const n = Number(value)
  if (isNaN(n)) return String(value)
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000)     return n.toLocaleString('en-NZ', { maximumFractionDigits: 2 })
  return n.toLocaleString('en-NZ', { maximumFractionDigits: 2 })
}

function isNumericCol(rows: (string | number | null)[][], colIdx: number): boolean {
  return rows.every(r => r[colIdx] == null || typeof r[colIdx] === 'number' || !isNaN(Number(r[colIdx])))
}

// ─── KPI Cards ───────────────────────────────────────────────────────────────

function KpiCards({ data }: { data: StructuredData }) {
  const kpis = data.kpis ?? []
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 18,
    }}>
      {kpis.map((kpi, i) => (
        <div key={i} style={{
          flex: '1 1 180px',
          background: i === 0 ? FOREST : PARCHMENT,
          border: `1px solid ${i === 0 ? JADE : FOG}`,
          borderRadius: 12, padding: '16px 20px',
        }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 9,
            letterSpacing: '0.14em', textTransform: 'uppercase',
            color: i === 0 ? 'rgba(214,217,212,0.5)' : SLATE,
            marginBottom: 6,
          }}>
            {kpi.label}
          </div>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 300,
            color: i === 0 ? '#D6D9D4' : INK, lineHeight: 1, marginBottom: 4,
          }}>
            {kpi.value}
          </div>
          {kpi.subtext && (
            <div style={{
              fontFamily: 'var(--font-body)', fontSize: 11,
              color: i === 0 ? 'rgba(214,217,212,0.45)' : SLATE,
            }}>
              {kpi.subtext}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Sortable Table ───────────────────────────────────────────────────────────

function SortableTable({ data }: { data: StructuredData }) {
  const columns = data.columns ?? []
  const rows    = data.rows    ?? []

  const [sortCol, setSortCol]   = useState<number | null>(null)
  const [sortAsc, setSortAsc]   = useState(true)

  function toggleSort(i: number) {
    if (sortCol === i) setSortAsc(a => !a)
    else { setSortCol(i); setSortAsc(true) }
  }

  const sorted = sortCol == null ? rows : [...rows].sort((a, b) => {
    const av = a[sortCol] ?? ''
    const bv = b[sortCol] ?? ''
    const an = Number(av), bn = Number(bv)
    const cmp = (!isNaN(an) && !isNaN(bn)) ? an - bn : String(av).localeCompare(String(bv))
    return sortAsc ? cmp : -cmp
  })

  // Identifier columns (Invoice No, Entry No, codes) show as text: no thousands separators
  const numericCols = columns.map((col, i) => !isIdentifierHeader(col) && isNumericCol(rows, i))

  return (
    <div style={{ marginTop: 18, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-body)' }}>
        <thead>
          <tr>
            {columns.map((col, i) => (
              <th
                key={i}
                onClick={() => toggleSort(i)}
                style={{
                  padding: '8px 12px',
                  textAlign: numericCols[i] ? 'right' : 'left',
                  fontFamily: 'var(--font-mono)', fontSize: 9,
                  letterSpacing: '0.12em', textTransform: 'uppercase',
                  color: sortCol === i ? FOREST : SLATE,
                  borderBottom: `2px solid ${sortCol === i ? JADE : FOG}`,
                  cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                  background: WHITE,
                }}
              >
                {col}{' '}
                {sortCol === i ? (sortAsc ? '↑' : '↓') : '↕'}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, ri) => (
            <tr
              key={ri}
              style={{ background: ri % 2 === 0 ? WHITE : PARCHMENT }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(26,146,114,0.05)')}
              onMouseLeave={e => (e.currentTarget.style.background = ri % 2 === 0 ? WHITE : PARCHMENT)}
            >
              {row.map((cell, ci) => (
                <td key={ci} style={{
                  padding: '7px 12px',
                  textAlign: numericCols[ci] ? 'right' : 'left',
                  color: INK,
                  borderBottom: `1px solid ${FOG}`,
                  fontFamily: numericCols[ci] ? 'var(--font-mono)' : 'var(--font-body)',
                  fontSize: numericCols[ci] ? 11 : 12,
                  whiteSpace: numericCols[ci] ? 'nowrap' : undefined,
                }}>
                  {numericCols[ci] ? fmt(cell) : (cell ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 9, color: SLATE,
        marginTop: 8, textAlign: 'right', letterSpacing: '0.1em',
      }}>
        {rows.length} record{rows.length !== 1 ? 's' : ''} · click column header to sort
      </div>
    </div>
  )
}

// ─── Bar Chart ────────────────────────────────────────────────────────────────

function BespoxBarChart({ data }: { data: StructuredData }) {
  const columns = data.columns ?? []
  const rows    = data.rows    ?? []
  if (columns.length < 2 || rows.length === 0) return null

  // First col = label, second col = value
  const labelKey = 'label'
  const valueKey = 'value'
  const chartData = rows.map(r => ({
    [labelKey]: String(r[0] ?? ''),
    [valueKey]: Number(r[1]) || 0,
  }))

  // Truncate label for readability on x-axis
  function shortLabel(s: string) {
    return s.length > 14 ? s.slice(0, 13) + '…' : s
  }

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 9,
        letterSpacing: '0.12em', textTransform: 'uppercase',
        color: SLATE, marginBottom: 8,
      }}>
        {columns[1]}
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={chartData} margin={{ top: 4, right: 4, left: 8, bottom: 40 }}>
          <CartesianGrid vertical={false} stroke={FOG} strokeWidth={0.5} />
          <XAxis
            dataKey={labelKey}
            tick={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: SLATE }}
            tickFormatter={shortLabel}
            angle={-35}
            textAnchor="end"
            interval={0}
            axisLine={false} tickLine={false}
          />
          <YAxis
            tick={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: SLATE }}
            tickFormatter={v => fmt(v)}
            axisLine={false} tickLine={false} width={60}
          />
          <Tooltip
            formatter={(v) => [fmt(v as number ?? 0), columns[1]]}
            labelStyle={{ color: '#D6D9D4', fontFamily: 'var(--font-mono)', fontSize: 10, marginBottom: 2 }}
            contentStyle={tooltipStyle}
            cursor={{ fill: 'rgba(26,146,114,0.06)' }}
          />
          <Bar dataKey={valueKey} radius={[4, 4, 0, 0]} maxBarSize={48}>
            {chartData.map((_, i) => (
              <Cell key={i} fill={i === 0 ? JADE : i % 3 === 1 ? FOREST : AMBER} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Line Chart ───────────────────────────────────────────────────────────────

function BespoxLineChart({ data }: { data: StructuredData }) {
  const columns = data.columns ?? []
  const rows    = data.rows    ?? []
  if (columns.length < 2 || rows.length === 0) return null

  const labelKey = 'label'
  const valueKey = 'value'
  const chartData = rows.map(r => ({
    [labelKey]: String(r[0] ?? ''),
    [valueKey]: Number(r[1]) || 0,
  }))

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 9,
        letterSpacing: '0.12em', textTransform: 'uppercase',
        color: SLATE, marginBottom: 8,
      }}>
        {columns[1]}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 4, right: 4, left: 8, bottom: 32 }}>
          <CartesianGrid stroke={FOG} strokeWidth={0.5} />
          <XAxis
            dataKey={labelKey}
            tick={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: SLATE }}
            angle={-25}
            textAnchor="end"
            interval={0}
            axisLine={false} tickLine={false}
          />
          <YAxis
            tick={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: SLATE }}
            tickFormatter={v => fmt(v)}
            axisLine={false} tickLine={false} width={60}
          />
          <Tooltip
            formatter={(v) => [fmt(v as number ?? 0), columns[1]]}
            labelStyle={{ color: '#D6D9D4', fontFamily: 'var(--font-mono)', fontSize: 10, marginBottom: 2 }}
            contentStyle={tooltipStyle}
            cursor={{ stroke: JADE, strokeWidth: 1 }}
          />
          <Line
            type="monotone"
            dataKey={valueKey}
            stroke={JADE}
            strokeWidth={2}
            dot={{ fill: JADE, r: 3, strokeWidth: 0 }}
            activeDot={{ fill: AMBER, r: 5, strokeWidth: 0 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function DataVisualizer({ displayHint, data }: Props) {
  if (!data) return null

  switch (displayHint) {
    case 'kpi':        return <KpiCards data={data} />
    case 'table':      return <SortableTable data={data} />
    case 'bar_chart':  return <BespoxBarChart data={data} />
    case 'line_chart': return <BespoxLineChart data={data} />
    default:           return null
  }
}
