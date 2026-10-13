import type { MetricParams, MetricResult } from '../types'

export interface SourceContext {
  today: Date
  fiscalYearStartMonth: number
}

/** A way of producing registry metrics. Implementations must cover every metric ID. */
export interface MetricSource {
  name: MetricResult['provenance']['source']
  implements: (metricId: string) => boolean
  fetch: (metricId: string, params: MetricParams, ctx: SourceContext) => Promise<MetricResult>
}
