import type { PeriodKey, CompareKey, ResolvedPeriod } from './types'

/**
 * Deterministic period maths — the AI never calculates dates for dashboards.
 *
 * YTD / last_year follow the tenant's fiscal years when known: the Starting
 * Dates of NAV Accounting Periods flagged New Fiscal Year (see
 * sources/fiscal-years.ts). Without them, the calendar year is used.
 * Months and quarters are always calendar.
 */

/** Fiscal-year start dates (YYYY-MM-DD) from NAV, any order. Empty = calendar year. */
export interface FiscalCalendar {
  starts: string[]
  source: 'nav' | 'calendar'
}

export const CALENDAR_YEAR: FiscalCalendar = { starts: [], source: 'calendar' }

const pad = (n: number) => (n < 10 ? '0' + n : String(n))
const ymd = (d: Date) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
const lastDayOf = (y: number, m: number) => new Date(y, m + 1, 0) // m is 0-based

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Start of the current and previous fiscal year — from NAV dates when they cover today, else calendar. */
function fyBounds(today: Date, fc: FiscalCalendar): { cur: Date; prev: Date } {
  const t = ymd(today)
  const starts = Array.from(new Set(fc.starts.map(s => s.slice(0, 10)))).sort()
  let i = -1
  for (let k = 0; k < starts.length; k++) if (starts[k] <= t) i = k
  if (i >= 0) {
    const cur = new Date(starts[i] + 'T00:00:00')
    // No earlier year recorded in NAV: assume the previous year was a full 12 months.
    const prev = i > 0 ? new Date(starts[i - 1] + 'T00:00:00') : new Date(cur.getFullYear() - 1, cur.getMonth(), cur.getDate())
    return { cur, prev }
  }
  return { cur: new Date(today.getFullYear(), 0, 1), prev: new Date(today.getFullYear() - 1, 0, 1) }
}

export function resolvePeriod(key: PeriodKey, today: Date = new Date(), fiscal: FiscalCalendar = CALENDAR_YEAR): ResolvedPeriod {
  const y = today.getFullYear()
  const m = today.getMonth()
  const q = Math.floor(m / 3)

  switch (key) {
    case 'this_month':
      return { key, label: MONTHS[m] + ' ' + y, from: ymd(new Date(y, m, 1)), to: ymd(lastDayOf(y, m)) }
    case 'last_month': {
      const d = new Date(y, m - 1, 1)
      return { key, label: MONTHS[d.getMonth()] + ' ' + d.getFullYear(), from: ymd(d), to: ymd(lastDayOf(d.getFullYear(), d.getMonth())) }
    }
    case 'this_quarter':
      return { key, label: 'Q' + (q + 1) + ' ' + y, from: ymd(new Date(y, q * 3, 1)), to: ymd(lastDayOf(y, q * 3 + 2)) }
    case 'last_quarter': {
      const d = new Date(y, q * 3 - 3, 1)
      const lq = Math.floor(d.getMonth() / 3)
      return { key, label: 'Q' + (lq + 1) + ' ' + d.getFullYear(), from: ymd(d), to: ymd(lastDayOf(d.getFullYear(), d.getMonth() + 2)) }
    }
    case 'ytd': {
      const { cur } = fyBounds(today, fiscal)
      return { key, label: 'YTD', from: ymd(cur), to: ymd(today) }
    }
    case 'last_year': {
      const { cur, prev } = fyBounds(today, fiscal)
      const end = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() - 1)
      return { key, label: 'Last year', from: ymd(prev), to: ymd(end) }
    }
    case 'last_12_months': {
      const s = new Date(y, m - 11, 1)
      return { key, label: 'Last 12 months', from: ymd(s), to: ymd(lastDayOf(y, m)) }
    }
    case 'as_at_today':
      return { key, label: 'As at ' + ymd(today), from: '0001-01-01', to: ymd(today) }
  }
}

/** Same-length period immediately before (prior_period) or one year earlier (prior_year). */
export function resolveCompare(p: ResolvedPeriod, compare: CompareKey): ResolvedPeriod | undefined {
  if (compare === 'none' || p.key === 'as_at_today') return undefined
  const from = new Date(p.from + 'T00:00:00')
  const to = new Date(p.to + 'T00:00:00')

  if (compare === 'prior_year') {
    const f = new Date(from.getFullYear() - 1, from.getMonth(), from.getDate())
    const t = new Date(to.getFullYear() - 1, to.getMonth(), to.getDate())
    return { key: p.key, label: p.label + ' (prior year)', from: ymd(f), to: ymd(t) }
  }

  // prior_period: whole-month periods shift by their month count, so
  // "Feb" compares to "Jan" (not a 28-day window).
  const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()) + 1
  const isWholeMonths = from.getDate() === 1 && to.getDate() === lastDayOf(to.getFullYear(), to.getMonth()).getDate()
  if (isWholeMonths) {
    const f = new Date(from.getFullYear(), from.getMonth() - months, 1)
    const t = lastDayOf(from.getFullYear(), from.getMonth() - 1)
    return { key: p.key, label: 'Prior period', from: ymd(f), to: ymd(t) }
  }
  // Partial period (e.g. YTD): same span ending the day before `from`, one year back.
  const f = new Date(from.getFullYear() - 1, from.getMonth(), from.getDate())
  const t = new Date(to.getFullYear() - 1, to.getMonth(), to.getDate())
  return { key: p.key, label: 'Same period last year', from: ymd(f), to: ymd(t) }
}

/** The last N calendar months ending this month, oldest first. */
export function monthBuckets(n: number, today: Date = new Date()): ResolvedPeriod[] {
  const out: ResolvedPeriod[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    out.push({
      key: 'this_month',
      label: MONTHS[d.getMonth()] + ' ' + String(d.getFullYear()).slice(2),
      from: ymd(d),
      to: ymd(lastDayOf(d.getFullYear(), d.getMonth())),
    })
  }
  return out
}

export { ymd }
