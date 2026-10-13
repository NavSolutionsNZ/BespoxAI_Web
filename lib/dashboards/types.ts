/**
 * Dashboard + metric registry types.
 *
 * Design (agreed Oct 2026):
 *  - The AI never queries BC directly for dashboards. Every number comes from a
 *    named metric in the registry (lib/dashboards/registry.ts).
 *  - A metric declares WHAT it measures. HOW it is fetched is a pluggable
 *    MetricSource ('flowfilter' today, 'queryObject' later, 'mock' for preview).
 *    Swapping sources never changes metric IDs, dashboard specs or the UI.
 *  - Every result carries provenance so a CFO can see where a figure came from.
 */

export type PeriodKey =
  | 'this_month' | 'last_month'
  | 'this_quarter' | 'last_quarter'
  | 'ytd' | 'last_year'
  | 'last_12_months'
  | 'as_at_today'

export type CompareKey = 'none' | 'prior_period' | 'prior_year'

export interface ResolvedPeriod {
  key: PeriodKey
  label: string
  from: string  // YYYY-MM-DD inclusive
  to: string    // YYYY-MM-DD inclusive
}

export interface MetricParams {
  period?: PeriodKey
  compare?: CompareKey
  top?: number            // for ranked metrics (top customers)
}

/** Shape of what a metric returns. */
export type MetricKind = 'scalar' | 'series' | 'breakdown'

export interface MetricProvenance {
  source: 'flowfilter' | 'queryObject' | 'mock'
  /** Human-readable description of the calculation, shown on click-through. */
  method: string
  /** The exact service calls made (URLs with the tunnel host stripped). */
  calls: string[]
  period?: ResolvedPeriod
  comparePeriod?: ResolvedPeriod
  asOf: string            // ISO timestamp the data was read
  rowsRead: number
  /** True when a row cap was hit — the figure may be incomplete. */
  truncated: boolean
  /** For YTD / last-year figures: where the fiscal year came from. */
  fiscalYear?: 'nav' | 'calendar'
}

export interface ScalarValue { value: number; compareValue?: number }
export interface SeriesValue { points: { label: string; value: number }[] }
export interface BreakdownValue { rows: { label: string; value: number; extra?: Record<string, number> }[] }

export interface MetricResult {
  metricId: string
  kind: MetricKind
  unit: 'currency' | 'count' | 'percent'
  scalar?: ScalarValue
  series?: SeriesValue
  breakdown?: BreakdownValue
  provenance: MetricProvenance
}

export interface MetricDefinition {
  id: string
  label: string
  description: string
  kind: MetricKind
  unit: MetricResult['unit']
  /** Which params this metric honours — used to validate specs. */
  acceptsPeriod: boolean
  acceptsCompare: boolean
  defaultParams: MetricParams
}

// ─── Dashboard spec ──────────────────────────────────────────────────────────

export type WidgetType = 'kpi' | 'line' | 'bar' | 'table'

export interface WidgetSpec {
  id: string
  type: WidgetType
  title: string
  metricId: string
  params?: MetricParams
  /** Grid width in 12ths. */
  width: 3 | 4 | 6 | 8 | 12
}

export interface DashboardSection {
  id: string
  title: string
  widgets: WidgetSpec[]
}

export interface DashboardSpec {
  version: 1
  name: string
  sections: DashboardSection[]
}

/** Thrown by sources when BC can't serve the call — surfaced to the UI as-is. */
export class MetricSourceError extends Error {
  constructor(
    public code: 'service_not_published' | 'field_not_available' | 'bc_unreachable' | 'bc_error' | 'not_supported',
    message: string,
    public detail?: string,
  ) {
    super(message)
  }
}
