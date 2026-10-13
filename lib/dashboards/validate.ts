import { METRICS } from './registry'
import type { DashboardSpec, MetricParams, WidgetType } from './types'

/**
 * Validates a dashboard spec before it is saved or rendered. Specs will come
 * from users and (later) the AI, so treat them as untrusted input.
 */

const PERIODS = new Set(['this_month', 'last_month', 'this_quarter', 'last_quarter', 'ytd', 'last_year', 'last_12_months', 'as_at_today'])
const COMPARES = new Set(['none', 'prior_period', 'prior_year'])
const WIDTHS = new Set([3, 4, 6, 8, 12])
const ID_RE = /^[a-z0-9-]{1,40}$/

/** Which widget types make sense for each metric kind. */
const TYPES_BY_KIND: Record<string, WidgetType[]> = {
  scalar: ['kpi'],
  series: ['line', 'bar', 'table'],
  breakdown: ['bar', 'table'],
}

export function validateParams(metricId: string, params: unknown): string[] {
  const errs: string[] = []
  const def = METRICS[metricId]
  if (!def) return ['Unknown metric "' + metricId + '"']
  if (params === undefined) return errs
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return ['params must be an object']
  const p = params as Record<string, unknown>
  for (const k of Object.keys(p)) if (!['period', 'compare', 'top'].includes(k)) errs.push('Unknown param "' + k + '"')
  if (p.period !== undefined) {
    if (!PERIODS.has(String(p.period))) errs.push('Invalid period "' + String(p.period) + '"')
    else if (!def.acceptsPeriod && p.period !== def.defaultParams.period) errs.push(metricId + ' does not take a period')
  }
  if (p.compare !== undefined) {
    if (!COMPARES.has(String(p.compare))) errs.push('Invalid compare "' + String(p.compare) + '"')
    else if (!def.acceptsCompare && p.compare !== 'none') errs.push(metricId + ' does not support comparison')
  }
  if (p.top !== undefined && (!Number.isInteger(p.top) || (p.top as number) < 1 || (p.top as number) > 50)) errs.push('top must be 1–50')
  return errs
}

export function validateSpec(spec: unknown): { ok: true; spec: DashboardSpec } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const s = spec as DashboardSpec
  if (!s || typeof s !== 'object') return { ok: false, errors: ['Spec must be an object'] }
  if (s.version !== 1) errors.push('Unsupported spec version')
  if (typeof s.name !== 'string' || !s.name.trim() || s.name.length > 80) errors.push('Name is required (max 80 chars)')
  if (!Array.isArray(s.sections) || s.sections.length === 0 || s.sections.length > 12) errors.push('1–12 sections required')

  const ids = new Set<string>()
  let widgetCount = 0
  for (const sec of Array.isArray(s.sections) ? s.sections : []) {
    if (!sec || !ID_RE.test(String(sec.id))) errors.push('Bad section id')
    if (typeof sec?.title !== 'string' || sec.title.length > 80) errors.push('Bad section title')
    for (const w of Array.isArray(sec?.widgets) ? sec.widgets : []) {
      widgetCount++
      const where = 'Widget "' + String(w?.id) + '": '
      if (!w || !ID_RE.test(String(w.id))) { errors.push(where + 'bad id'); continue }
      if (ids.has(w.id)) errors.push(where + 'duplicate id')
      ids.add(w.id)
      const def = METRICS[w.metricId]
      if (!def) { errors.push(where + 'unknown metric "' + String(w.metricId) + '"'); continue }
      if (!TYPES_BY_KIND[def.kind].includes(w.type)) errors.push(where + w.type + ' cannot display a ' + def.kind + ' metric')
      if (!WIDTHS.has(w.width)) errors.push(where + 'width must be 3, 4, 6, 8 or 12')
      if (typeof w.title !== 'string' || !w.title.trim() || w.title.length > 80) errors.push(where + 'title required (max 80)')
      for (const e of validateParams(w.metricId, w.params)) errors.push(where + e)
    }
  }
  if (widgetCount > 40) errors.push('Too many widgets (max 40)')
  return errors.length ? { ok: false, errors } : { ok: true, spec: s }
}

export function effectiveParams(metricId: string, params?: MetricParams): MetricParams {
  return { ...METRICS[metricId]?.defaultParams, ...(params ?? {}) }
}
