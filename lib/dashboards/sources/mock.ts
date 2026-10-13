import { AGING_BUCKETS } from '../registry'
import { METRICS } from '../registry'
import { monthBuckets, resolveCompare, resolvePeriod } from '../periods'
import type { MetricParams, MetricResult } from '../types'
import type { MetricSource, SourceContext } from './source'

/**
 * Deterministic mock data for preview and tests. Same inputs → same numbers.
 * Never used for a customer tenant's live dashboard.
 */

function seeded(seed: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
}

const round = (n: number) => Math.round(n)

function monthRevenue(label: string): number {
  return round(380_000 + seeded('rev' + label)() * 140_000)
}

export const mockSource: MetricSource = {
  name: 'mock',
  implements: id => id in METRICS,
  async fetch(metricId: string, params: MetricParams, ctx: SourceContext): Promise<MetricResult> {
    const period = resolvePeriod(params.period ?? 'this_month', ctx.today, ctx.fiscalYearStartMonth)
    const compare = resolveCompare(period, params.compare ?? 'none')
    const provenance = {
      source: 'mock' as const,
      method: 'Mock data for preview — not from Business Central.',
      calls: [], period, comparePeriod: compare,
      asOf: new Date().toISOString(), rowsRead: 0, truncated: false,
    }
    const months = (p: { from: string; to: string }) => {
      const f = new Date(p.from + 'T00:00:00'), t = new Date(p.to + 'T00:00:00')
      return Math.max(1, (t.getFullYear() - f.getFullYear()) * 12 + t.getMonth() - f.getMonth() + 1)
    }
    const pl = (p: { from: string; to: string }) => {
      const r = seeded('pl' + p.from + p.to)
      const revenue = round(months(p) * (400_000 + r() * 90_000))
      const cogs = round(revenue * (0.55 + r() * 0.08))
      const expense = round(revenue * (0.22 + r() * 0.06))
      return { revenue, cogs, expense, net: revenue - cogs - expense }
    }

    switch (metricId) {
      case 'pl_revenue':
      case 'pl_gross_margin':
      case 'pl_net_profit': {
        const pick = (t: ReturnType<typeof pl>) =>
          metricId === 'pl_revenue' ? t.revenue : metricId === 'pl_gross_margin' ? t.revenue - t.cogs : t.net
        return { metricId, kind: 'scalar', unit: 'currency', scalar: { value: pick(pl(period)), compareValue: compare ? pick(pl(compare)) : undefined }, provenance }
      }
      case 'pl_summary': {
        const c = pl(period), p = compare ? pl(compare) : undefined
        const line = (label: string, f: (t: ReturnType<typeof pl>) => number) => ({ label, value: f(c), extra: p ? { compare: f(p) } : undefined })
        return { metricId, kind: 'breakdown', unit: 'currency', provenance, breakdown: { rows: [
          line('Revenue', t => t.revenue), line('Cost of goods sold', t => t.cogs),
          line('Gross margin', t => t.revenue - t.cogs), line('Expenses', t => t.expense), line('Net profit', t => t.net),
        ] } }
      }
      case 'cash_total':
      case 'cash_by_account': {
        const rows = [
          { label: 'Operating account', value: 612_430 },
          { label: 'Savings account', value: 250_000 },
          { label: 'USD account', value: 84_915 },
        ]
        return metricId === 'cash_total'
          ? { metricId, kind: 'scalar', unit: 'currency', scalar: { value: rows.reduce((s, r) => s + r.value, 0) }, provenance }
          : { metricId, kind: 'breakdown', unit: 'currency', breakdown: { rows }, provenance }
      }
      case 'cash_trend':
      case 'sales_trend': {
        let bal = 720_000
        const points = monthBuckets(12, ctx.today).map(m => {
          if (metricId === 'sales_trend') return { label: m.label, value: monthRevenue(m.label) }
          bal += round((seeded('cash' + m.label)() - 0.42) * 90_000)
          return { label: m.label, value: bal }
        })
        return { metricId, kind: 'series', unit: 'currency', series: { points }, provenance }
      }
      case 'ar_aging':
      case 'ar_overdue':
      case 'ap_aging':
      case 'ap_overdue': {
        const base = metricId.startsWith('ar') ? [412_000, 168_500, 61_200, 22_800, 14_300] : [298_000, 96_400, 18_700, 4_100, 0]
        if (metricId.endsWith('overdue')) {
          return { metricId, kind: 'scalar', unit: 'currency', scalar: { value: base.slice(1).reduce((s, v) => s + v, 0) }, provenance }
        }
        return { metricId, kind: 'breakdown', unit: 'currency', breakdown: { rows: AGING_BUCKETS.map((k, i) => ({ label: k, value: base[i] })) }, provenance }
      }
      case 'top_customers': {
        const names = ['Harbour Foods Ltd', 'Kauri Building Supplies', 'Southern Cross Retail', 'Tasman Freight', 'Pacific Hardware Co', 'Alpine Outdoor', 'Coastal Pharmacy Group', 'Northland Dairy', 'Summit Electrical', 'Waitematā Interiors', 'Ruapehu Motors', 'Canterbury Print']
        const r = seeded('top' + period.from)
        const rows = names.map((label, i) => ({ label, value: round((names.length - i) * 48_000 + r() * 30_000) }))
          .sort((a, b) => b.value - a.value).slice(0, Math.min(Math.max(params.top ?? 10, 1), 50))
        return { metricId, kind: 'breakdown', unit: 'currency', breakdown: { rows }, provenance }
      }
    }
    throw new Error('Mock source has no data for ' + metricId)
  },
}
