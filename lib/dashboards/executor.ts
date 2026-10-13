import { METRICS } from './registry'
import { effectiveParams, validateParams } from './validate'
import type { MetricParams, MetricResult } from './types'
import type { MetricSource } from './sources/source'
import { CALENDAR_YEAR, type FiscalCalendar } from './periods'

/** Tenant country → IANA zone, so "today" and month boundaries match the customer's books. */
const COUNTRY_TZ: Record<string, string> = {
  NZ: 'Pacific/Auckland', AU: 'Australia/Sydney', GB: 'Europe/London',
  US: 'America/New_York', SG: 'Asia/Singapore', MY: 'Asia/Kuala_Lumpur', ID: 'Asia/Jakarta',
}

/** Midnight (server-local Date) of the current calendar day in the tenant's zone. */
export function tenantToday(country: string | null | undefined, now: Date = new Date()): Date {
  const tz = COUNTRY_TZ[country ?? 'NZ'] ?? 'Pacific/Auckland'
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const [y, m, d] = parts.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export async function fetchMetric(
  source: MetricSource,
  metricId: string,
  params: MetricParams | undefined,
  opts: { today: Date; fiscal?: FiscalCalendar },
): Promise<MetricResult> {
  if (!METRICS[metricId]) throw new Error('Unknown metric ' + metricId)
  const errs = validateParams(metricId, params)
  if (errs.length) throw new Error(errs.join('; '))
  if (!source.implements(metricId)) throw new Error(source.name + ' source does not implement ' + metricId)
  return source.fetch(metricId, effectiveParams(metricId, params), {
    today: opts.today,
    fiscal: opts.fiscal ?? CALENDAR_YEAR,
  })
}
