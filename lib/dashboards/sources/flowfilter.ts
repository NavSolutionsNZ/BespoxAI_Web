import type { TenantConfig } from '@/lib/tenants'
import { BC_SERVICES, dateFilterExpr, optKey, type BcServiceKey } from '../bc-services'
import { AGING_BUCKETS, agingBucket } from '../registry'
import { CALENDAR_YEAR, monthBuckets, resolveCompare, resolvePeriod, ymd, type FiscalCalendar } from '../periods'
import {
  MetricSourceError,
  type MetricParams, type MetricProvenance, type MetricResult, type ResolvedPeriod,
} from '../types'
import type { MetricSource, SourceContext } from './source'

/**
 * FlowFilter source: NAV does the aggregation via FlowFields on standard pages
 * published as web services. The portal only sums small, already-aggregated
 * row sets (accounts, bank accounts, customers) or open ledger entries.
 */

const ROW_CAP = 20_000
const PAGE_SIZE = 5_000

/** buildODataUrl from lib/tenants — injected so this module never loads Prisma. */
export type UrlBuilder = (tenant: TenantConfig, entity: string, params?: string) => string

export type JsonFetcher = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string> }>

interface Ctx {
  tenant: TenantConfig
  fetcher: JsonFetcher
  buildUrl: UrlBuilder
  calls: string[]
  rowsRead: number
  truncated: boolean
}

function displayUrl(url: string): string {
  // Strip the tunnel host — provenance is shown to users and stored.
  return url.replace(/^https:\/\/[^/]+/, '')
}

async function readService(c: Ctx, key: BcServiceKey, query: { filter?: string; select?: string[] }): Promise<any[]> {
  const svc = BC_SERVICES[key]
  const parts: string[] = ['$top=' + PAGE_SIZE]
  if (query.filter) parts.push('$filter=' + encodeURIComponent(query.filter))
  parts.push('$select=' + (query.select ?? svc.fields).join(','))
  let url: string | null = c.buildUrl(c.tenant, svc.serviceName, parts.join('&'))
  const rows: any[] = []

  while (url) {
    c.calls.push(displayUrl(url))
    let res
    try {
      res = await c.fetcher(url)
    } catch (e: any) {
      throw new MetricSourceError('bc_unreachable', 'Could not reach Business Central through the BespoxAI Agent.', e?.message)
    }
    if (res.status === 404) {
      throw new MetricSourceError('service_not_published',
        'The ' + svc.pageName + ' web service (' + svc.serviceName + ') is not published on this server.')
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      if (/property|field|could not find/i.test(body)) {
        throw new MetricSourceError('field_not_available',
          'A field required from ' + svc.pageName + ' is not available on this NAV version.', body.slice(0, 300))
      }
      throw new MetricSourceError('bc_error', 'Business Central returned an error (' + res.status + ').', body.slice(0, 300))
    }
    const data = await res.json()
    const page: any[] = Array.isArray(data?.value) ? data.value : []
    rows.push(...page)
    c.rowsRead += page.length
    if (rows.length >= ROW_CAP) { c.truncated = true; break }
    const next: unknown = data?.['@odata.nextLink']
    url = typeof next === 'string' && next.length > 0 ? next : null
    // nextLink must stay on the same tunnel host — never follow elsewhere.
    if (url && !url.startsWith(c.tenant.agentBaseUrl)) url = null
  }
  return rows
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0)

// ─── G/L based P&L ───────────────────────────────────────────────────────────

interface PlTotals { revenue: number; cogs: number; expense: number; net: number }

async function plTotals(c: Ctx, p: ResolvedPeriod): Promise<PlTotals> {
  const rows = await readService(c, 'glAccounts', { filter: dateFilterExpr(p.from, p.to) })
  const t: PlTotals = { revenue: 0, cogs: 0, expense: 0, net: 0 }
  let sawCategory = false
  for (const r of rows) {
    if (optKey(r.Account_Type) !== 'posting') continue
    if (optKey(r.Income_Balance) !== 'incomestatement') continue
    const amt = num(r.Net_Change)
    t.net += amt
    const cat = optKey(r.Account_Category)
    if (cat) sawCategory = true
    if (cat === 'income') t.revenue += amt
    else if (cat === 'costofgoodssold') t.cogs += amt
    else if (cat === 'expense') t.expense += amt
  }
  if (rows.length > 0 && !sawCategory) {
    throw new MetricSourceError('field_not_available',
      'G/L accounts have no Account Category set, so revenue and costs can\'t be separated yet. An account-range mapping is needed for this company.')
  }
  // NAV stores income as credits (negative) — flip so revenue and profit read positive.
  return { revenue: -t.revenue, cogs: t.cogs, expense: t.expense, net: -t.net }
}

// ─── Ledger aging ────────────────────────────────────────────────────────────

async function aging(c: Ctx, key: 'custLedgerEntries' | 'vendLedgerEntries', today: Date, sign: 1 | -1) {
  const rows = await readService(c, key, { filter: 'Open eq true' })
  const buckets: Record<string, number> = {}
  for (const b of AGING_BUCKETS) buckets[b] = 0
  for (const r of rows) {
    if (!r.Due_Date) continue
    buckets[agingBucket(String(r.Due_Date), today)] += sign * num(r.Remaining_Amt_LCY)
  }
  return buckets
}

// ─── Source ──────────────────────────────────────────────────────────────────

const IMPLEMENTED = new Set([
  'pl_revenue', 'pl_gross_margin', 'pl_net_profit', 'pl_summary',
  'cash_total', 'cash_by_account', 'cash_trend',
  'ar_overdue', 'ar_aging', 'ap_overdue', 'ap_aging',
  'sales_trend', 'top_customers',
])

export function createFlowFilterSource(tenant: TenantConfig, deps: { fetcher: JsonFetcher; buildUrl: UrlBuilder }): MetricSource {
  return {
    name: 'flowfilter',
    implements: id => IMPLEMENTED.has(id),
    async fetch(metricId: string, params: MetricParams, sctx: SourceContext): Promise<MetricResult> {
      const c: Ctx = { tenant, fetcher: deps.fetcher, buildUrl: deps.buildUrl, calls: [], rowsRead: 0, truncated: false }
      const today = sctx.today
      const prov = (method: string, period?: ResolvedPeriod, comparePeriod?: ResolvedPeriod): MetricProvenance => ({
        source: 'flowfilter', method, calls: c.calls, period, comparePeriod,
        asOf: new Date().toISOString(), rowsRead: c.rowsRead, truncated: c.truncated,
        fiscalYear: period && (period.key === 'ytd' || period.key === 'last_year') ? sctx.fiscal.source : undefined,
      })
      const period = resolvePeriod(params.period ?? 'this_month', today, sctx.fiscal)
      const compare = resolveCompare(period, params.compare ?? 'none')

      switch (metricId) {
        case 'pl_revenue':
        case 'pl_gross_margin':
        case 'pl_net_profit': {
          const pick = (t: PlTotals) =>
            metricId === 'pl_revenue' ? t.revenue : metricId === 'pl_gross_margin' ? t.revenue - t.cogs : t.net
          const cur = await plTotals(c, period)
          const prev = compare ? await plTotals(c, compare) : undefined
          return {
            metricId, kind: 'scalar', unit: 'currency',
            scalar: { value: pick(cur), compareValue: prev ? pick(prev) : undefined },
            provenance: prov('Chart of Accounts Net Change with Date Filter, posting income-statement accounts grouped by Account Category.', period, compare),
          }
        }
        case 'pl_summary': {
          const cur = await plTotals(c, period)
          const prev = compare ? await plTotals(c, compare) : undefined
          const line = (label: string, f: (t: PlTotals) => number) => ({
            label, value: f(cur), extra: prev ? { compare: f(prev) } : undefined,
          })
          return {
            metricId, kind: 'breakdown', unit: 'currency',
            breakdown: { rows: [
              line('Revenue', t => t.revenue),
              line('Cost of goods sold', t => t.cogs),
              line('Gross margin', t => t.revenue - t.cogs),
              line('Expenses', t => t.expense),
              line('Net profit', t => t.net),
            ] },
            provenance: prov('Chart of Accounts Net Change with Date Filter, grouped by Account Category.', period, compare),
          }
        }
        case 'cash_total':
        case 'cash_by_account': {
          const asAt = resolvePeriod('as_at_today', today)
          const rows = await readService(c, 'bankAccounts', { filter: dateFilterExpr(asAt.from, asAt.to) })
          const list = rows.map(r => ({ label: String(r.Name || r.No), value: num(r.Balance_at_Date_LCY) }))
          const method = 'Bank Account Balance at Date (LCY) with Date Filter up to today.'
          if (metricId === 'cash_total') {
            return { metricId, kind: 'scalar', unit: 'currency', scalar: { value: list.reduce((s, r) => s + r.value, 0) }, provenance: prov(method, asAt) }
          }
          list.sort((a, b) => b.value - a.value)
          return { metricId, kind: 'breakdown', unit: 'currency', breakdown: { rows: list }, provenance: prov(method, asAt) }
        }
        case 'cash_trend': {
          const points: { label: string; value: number }[] = []
          for (const m of monthBuckets(12, today)) {
            const rows = await readService(c, 'bankAccounts', { filter: dateFilterExpr('0001-01-01', m.to), select: ['No', 'Balance_at_Date_LCY'] })
            points.push({ label: m.label, value: rows.reduce((s, r) => s + num(r.Balance_at_Date_LCY), 0) })
          }
          return { metricId, kind: 'series', unit: 'currency', series: { points }, provenance: prov('Bank Account Balance at Date (LCY) at each month end.') }
        }
        case 'ar_aging':
        case 'ar_overdue':
        case 'ap_aging':
        case 'ap_overdue': {
          const isAr = metricId.startsWith('ar')
          // Vendor remaining amounts are credits (negative) — flip so owed reads positive.
          const b = await aging(c, isAr ? 'custLedgerEntries' : 'vendLedgerEntries', today, isAr ? 1 : -1)
          const method = (isAr ? 'Customer' : 'Vendor') + ' Ledger Entries filtered Open = Yes, Remaining Amt. (LCY) bucketed by days past Due Date (as at ' + ymd(today) + ').'
          if (metricId.endsWith('overdue')) {
            const overdue = AGING_BUCKETS.filter(x => x !== 'Not due').reduce((s, k) => s + b[k], 0)
            return { metricId, kind: 'scalar', unit: 'currency', scalar: { value: overdue }, provenance: prov(method) }
          }
          return { metricId, kind: 'breakdown', unit: 'currency', breakdown: { rows: AGING_BUCKETS.map(k => ({ label: k, value: b[k] })) }, provenance: prov(method) }
        }
        case 'sales_trend': {
          const points: { label: string; value: number }[] = []
          for (const m of monthBuckets(12, today)) {
            points.push({ label: m.label, value: (await plTotals(c, m)).revenue })
          }
          return { metricId, kind: 'series', unit: 'currency', series: { points }, provenance: prov('Revenue (Income accounts Net Change) per calendar month.') }
        }
        case 'top_customers': {
          const rows = await readService(c, 'customers', { filter: dateFilterExpr(period.from, period.to) })
          const ranked = rows
            .map(r => ({ label: String(r.Name || r.No), value: num(r.Sales_LCY) }))
            .filter(r => r.value !== 0)
            .sort((a, b) => b.value - a.value)
            .slice(0, Math.min(Math.max(params.top ?? 10, 1), 50))
          return { metricId, kind: 'breakdown', unit: 'currency', breakdown: { rows: ranked }, provenance: prov('Customer Sales (LCY) with Date Filter, ranked.', period) }
        }
      }
      throw new MetricSourceError('not_supported', 'Metric ' + metricId + ' is not implemented by the FlowFilter source.')
    },
  }
}

// ─── Fiscal years ────────────────────────────────────────────────────────────

const FISCAL_TTL_MS = 6 * 60 * 60 * 1000
const fiscalCache = new Map<string, { at: number; value: FiscalCalendar }>()

/**
 * The company's fiscal-year start dates: Accounting Periods with New Fiscal
 * Year = Yes. Never throws — if the page isn't published or readable, the
 * calendar year is used and provenance says so. Cached per tenant+company.
 */
export async function loadFiscalCalendar(tenant: TenantConfig, deps: { fetcher: JsonFetcher; buildUrl: UrlBuilder }): Promise<FiscalCalendar> {
  const key = tenant.tenantId + '|' + tenant.bcCompany
  const hit = fiscalCache.get(key)
  if (hit && Date.now() - hit.at < FISCAL_TTL_MS) return hit.value

  let value: FiscalCalendar = CALENDAR_YEAR
  try {
    const c: Ctx = { tenant, fetcher: deps.fetcher, buildUrl: deps.buildUrl, calls: [], rowsRead: 0, truncated: false }
    const rows = await readService(c, 'accountingPeriods', { filter: 'New_Fiscal_Year eq true' })
    const starts = rows
      .filter(r => r.New_Fiscal_Year === true || optKey(r.New_Fiscal_Year) === 'true' || optKey(r.New_Fiscal_Year) === 'yes')
      .map(r => String(r.Starting_Date ?? '').slice(0, 10))
      .filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s) && s > '0001-01-01')
    if (starts.length) value = { starts, source: 'nav' }
  } catch {
    // Not published / not reachable yet → calendar year. Don't cache failures for long.
    fiscalCache.set(key, { at: Date.now() - FISCAL_TTL_MS + 10 * 60 * 1000, value })
    return value
  }
  fiscalCache.set(key, { at: Date.now(), value })
  return value
}

/** Production fetcher: goes through the tenant's BespoxAI Agent tunnel. */
export function agentFetcher(tenant: TenantConfig): JsonFetcher {
  return url => fetch(url, {
    headers: { 'X-BespoxAI-Key': tenant.apiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  })
}
