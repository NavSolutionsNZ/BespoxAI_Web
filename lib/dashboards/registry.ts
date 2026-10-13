import type { MetricDefinition } from './types'

/**
 * The metric registry — the only numbers a dashboard can show.
 *
 * Adding a metric: add a definition here AND an implementation in every
 * source (sources/flowfilter.ts, sources/mock.ts; later sources/query-object.ts).
 * scripts/test-dashboards.ts fails if a source is missing an implementation.
 */
export const METRICS: Record<string, MetricDefinition> = {
  // ── P&L ────────────────────────────────────────────────────────────────────
  pl_revenue: {
    id: 'pl_revenue', label: 'Revenue', kind: 'scalar', unit: 'currency',
    description: 'Net change on income-statement accounts categorised as Income, sign-reversed.',
    acceptsPeriod: true, acceptsCompare: true, defaultParams: { period: 'this_month', compare: 'prior_period' },
  },
  pl_gross_margin: {
    id: 'pl_gross_margin', label: 'Gross margin', kind: 'scalar', unit: 'currency',
    description: 'Revenue less Cost of Goods Sold accounts for the period.',
    acceptsPeriod: true, acceptsCompare: true, defaultParams: { period: 'this_month', compare: 'prior_period' },
  },
  pl_net_profit: {
    id: 'pl_net_profit', label: 'Net profit', kind: 'scalar', unit: 'currency',
    description: 'Net change across all income-statement accounts, sign-reversed (profit positive).',
    acceptsPeriod: true, acceptsCompare: true, defaultParams: { period: 'this_month', compare: 'prior_period' },
  },
  pl_summary: {
    id: 'pl_summary', label: 'P&L summary', kind: 'breakdown', unit: 'currency',
    description: 'Revenue, cost of goods sold, gross margin, expenses and net profit, with comparison.',
    acceptsPeriod: true, acceptsCompare: true, defaultParams: { period: 'this_month', compare: 'prior_period' },
  },

  // ── Cash & bank ────────────────────────────────────────────────────────────
  cash_total: {
    id: 'cash_total', label: 'Cash & bank', kind: 'scalar', unit: 'currency',
    description: 'Sum of bank account balances in local currency, as at today.',
    acceptsPeriod: false, acceptsCompare: false, defaultParams: { period: 'as_at_today' },
  },
  cash_by_account: {
    id: 'cash_by_account', label: 'Balance by bank account', kind: 'breakdown', unit: 'currency',
    description: 'Each bank account balance in local currency, as at today.',
    acceptsPeriod: false, acceptsCompare: false, defaultParams: { period: 'as_at_today' },
  },
  cash_trend: {
    id: 'cash_trend', label: 'Cash trend', kind: 'series', unit: 'currency',
    description: 'Total bank balance at each month end, last 12 months.',
    acceptsPeriod: false, acceptsCompare: false, defaultParams: {},
  },

  // ── AR / AP ────────────────────────────────────────────────────────────────
  ar_overdue: {
    id: 'ar_overdue', label: 'Overdue debtors', kind: 'scalar', unit: 'currency',
    description: 'Remaining amount on open customer ledger entries past their due date.',
    acceptsPeriod: false, acceptsCompare: false, defaultParams: {},
  },
  ar_aging: {
    id: 'ar_aging', label: 'Debtor aging', kind: 'breakdown', unit: 'currency',
    description: 'Open customer ledger entries bucketed by days past due date.',
    acceptsPeriod: false, acceptsCompare: false, defaultParams: {},
  },
  ap_overdue: {
    id: 'ap_overdue', label: 'Overdue creditors', kind: 'scalar', unit: 'currency',
    description: 'Remaining amount on open vendor ledger entries past their due date.',
    acceptsPeriod: false, acceptsCompare: false, defaultParams: {},
  },
  ap_aging: {
    id: 'ap_aging', label: 'Creditor aging', kind: 'breakdown', unit: 'currency',
    description: 'Open vendor ledger entries bucketed by days past due date.',
    acceptsPeriod: false, acceptsCompare: false, defaultParams: {},
  },

  // ── Sales ──────────────────────────────────────────────────────────────────
  sales_trend: {
    id: 'sales_trend', label: 'Revenue trend', kind: 'series', unit: 'currency',
    description: 'Revenue (Income accounts) per month, last 12 months.',
    acceptsPeriod: false, acceptsCompare: false, defaultParams: {},
  },
  top_customers: {
    id: 'top_customers', label: 'Top customers', kind: 'breakdown', unit: 'currency',
    description: 'Customers ranked by Sales (LCY) for the period.',
    acceptsPeriod: true, acceptsCompare: false, defaultParams: { period: 'ytd', top: 10 },
  },
}

export const AGING_BUCKETS = ['Not due', '1–30', '31–60', '61–90', '90+'] as const

export function agingBucket(dueDate: string, today: Date): typeof AGING_BUCKETS[number] {
  const due = new Date(dueDate.slice(0, 10) + 'T00:00:00')
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const days = Math.floor((t.getTime() - due.getTime()) / 86400000)
  if (days <= 0) return 'Not due'
  if (days <= 30) return '1–30'
  if (days <= 60) return '31–60'
  if (days <= 90) return '61–90'
  return '90+'
}
