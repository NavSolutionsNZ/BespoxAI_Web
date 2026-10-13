import type { PeriodKey, CompareKey, ResolvedPeriod } from './types'

/**
 * Deterministic period maths — the AI never calculates dates for dashboards.
 *
 * Note: YTD / last_year are CALENDAR-year for now. NAV fiscal years come from
 * the Accounting Period table; reading that per tenant is a later slice
 * (fiscalYearStartMonth is the hook — 1 = January).
 */

const pad = (n: number) => (n < 10 ? '0' + n : String(n))
const ymd = (d: Date) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
const lastDayOf = (y: number, m: number) => new Date(y, m + 1, 0) // m is 0-based

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fyStart(today: Date, fyStartMonth: number): Date {
  const m0 = fyStartMonth - 1
  const y = today.getMonth() >= m0 ? today.getFullYear() : today.getFullYear() - 1
  return new Date(y, m0, 1)
}

export function resolvePeriod(key: PeriodKey, today: Date = new Date(), fiscalYearStartMonth = 1): ResolvedPeriod {
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
      const s = fyStart(today, fiscalYearStartMonth)
      return { key, label: 'YTD', from: ymd(s), to: ymd(today) }
    }
    case 'last_year': {
      const s = fyStart(today, fiscalYearStartMonth)
      const ps = new Date(s.getFullYear() - 1, s.getMonth(), 1)
      const pe = new Date(s.getFullYear(), s.getMonth(), 0)
      return { key, label: 'Last year', from: ymd(ps), to: ymd(pe) }
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
