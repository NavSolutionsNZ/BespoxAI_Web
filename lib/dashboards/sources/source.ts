import type { MetricParams, MetricResult } from '../types'
import type { FiscalCalendar } from '../periods'

export interface SourceContext {
  today: Date
  fiscal: FiscalCalendar
}

/** A way of producing registry metrics. Implementations must cover every metric ID. */
export interface MetricSource {
  name: MetricResult['provenance']['source']
  implements: (metricId: string) => boolean
  fetch: (metricId: string, params: MetricParams, ctx: SourceContext) => Promise<MetricResult>
}
