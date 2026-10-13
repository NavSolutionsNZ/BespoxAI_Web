import { METRICS } from './registry'
import type { DashboardSpec, WidgetSpec, WidgetType } from './types'

/**
 * Pure spec-editing helpers used by the dashboard editor. Each returns a new
 * spec and never mutates its input. The server re-validates every save.
 */

const clone = (s: DashboardSpec): DashboardSpec => JSON.parse(JSON.stringify(s))

export const DEFAULT_TYPE: Record<string, WidgetType> = { scalar: 'kpi', series: 'line', breakdown: 'bar' }
export const TYPES_FOR_KIND: Record<string, WidgetType[]> = {
  scalar: ['kpi'], series: ['line', 'bar', 'table'], breakdown: ['bar', 'table'],
}

function uniqueId(spec: DashboardSpec, base: string): string {
  const used = new Set(spec.sections.flatMap(s => [s.id, ...s.widgets.map(w => w.id)]))
  const stem = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'w'
  if (!used.has(stem)) return stem
  for (let i = 2; ; i++) if (!used.has(stem + '-' + i)) return stem + '-' + i
}

export function newWidget(spec: DashboardSpec, metricId: string): WidgetSpec {
  const def = METRICS[metricId]
  if (!def) throw new Error('Unknown metric ' + metricId)
  return {
    id: uniqueId(spec, metricId),
    type: DEFAULT_TYPE[def.kind],
    title: def.label,
    metricId,
    params: { ...def.defaultParams },
    width: def.kind === 'scalar' ? 4 : 6,
  }
}

export function addWidget(spec: DashboardSpec, sectionId: string, metricId: string): DashboardSpec {
  const s = clone(spec)
  const sec = s.sections.find(x => x.id === sectionId)
  if (!sec) throw new Error('Unknown section')
  sec.widgets.push(newWidget(s, metricId))
  return s
}

export function updateWidget(spec: DashboardSpec, widgetId: string, patch: Partial<Omit<WidgetSpec, 'id' | 'metricId'>>): DashboardSpec {
  const s = clone(spec)
  for (const sec of s.sections) {
    const i = sec.widgets.findIndex(w => w.id === widgetId)
    if (i >= 0) {
      const w = { ...sec.widgets[i], ...patch }
      if (patch.params) w.params = { ...sec.widgets[i].params, ...patch.params }
      sec.widgets[i] = w
    }
  }
  return s
}

export function removeWidget(spec: DashboardSpec, widgetId: string): DashboardSpec {
  const s = clone(spec)
  for (const sec of s.sections) sec.widgets = sec.widgets.filter(w => w.id !== widgetId)
  return s
}

/** Move within its section by -1 / +1. No-op at the ends. */
export function moveWidget(spec: DashboardSpec, widgetId: string, dir: -1 | 1): DashboardSpec {
  const s = clone(spec)
  for (const sec of s.sections) {
    const i = sec.widgets.findIndex(w => w.id === widgetId)
    const j = i + dir
    if (i >= 0 && j >= 0 && j < sec.widgets.length) {
      const t = sec.widgets[i]; sec.widgets[i] = sec.widgets[j]; sec.widgets[j] = t
    }
  }
  return s
}

export function addSection(spec: DashboardSpec, title: string): DashboardSpec {
  const s = clone(spec)
  s.sections.push({ id: uniqueId(s, title || 'section'), title: title || 'New section', widgets: [] })
  return s
}

export function renameSection(spec: DashboardSpec, sectionId: string, title: string): DashboardSpec {
  const s = clone(spec)
  const sec = s.sections.find(x => x.id === sectionId)
  if (sec) sec.title = title
  return s
}

export function removeSection(spec: DashboardSpec, sectionId: string): DashboardSpec {
  const s = clone(spec)
  s.sections = s.sections.filter(x => x.id !== sectionId)
  return s
}

/** Empty sections are dropped on save — the validator treats them as fine, but they render as blank headings. */
export function tidy(spec: DashboardSpec): DashboardSpec {
  const s = clone(spec)
  s.sections = s.sections.filter(x => x.widgets.length > 0)
  return s
}
