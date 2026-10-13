import { METRICS } from './registry'
import { TYPES_FOR_KIND, addSection, addWidget, removeWidget, updateWidget } from './edit'
import { validateParams, validateSpec } from './validate'
import type { DashboardSpec, MetricParams, WidgetSpec } from './types'

/**
 * AI dashboard editing. The model sees the metric catalogue and the current
 * layout — never financial figures — and returns structured edit operations.
 * Each op is applied with the same helpers as the manual editor; invalid ops
 * are dropped (and reported), and the result must pass validateSpec.
 */

const PERIODS = ['this_month', 'last_month', 'this_quarter', 'last_quarter', 'ytd', 'last_year', 'last_12_months']
const WIDTHS = [3, 4, 6, 8, 12]

export function buildSystemPrompt(): string {
  const catalogue = Object.values(METRICS).map(m => {
    const opts: string[] = ['types: ' + TYPES_FOR_KIND[m.kind].join('|')]
    if (m.acceptsPeriod) opts.push('period')
    if (m.acceptsCompare) opts.push('compare')
    if (m.id === 'top_customers') opts.push('top (1–50)')
    return '- ' + m.id + ' — ' + m.label + ': ' + m.description + ' [' + opts.join('; ') + ']'
  }).join('\n')

  return [
    'You edit CFO dashboards for Microsoft Dynamics NAV / Business Central customers.',
    'You can ONLY use these metrics. Never invent metrics, fields or queries:',
    catalogue,
    '',
    'Periods: ' + PERIODS.join(', ') + '. Compare: none, prior_period, prior_year. Widths (12ths): ' + WIDTHS.join(', ') + '.',
    'Widget types: kpi (single figure), line, bar, table — only the types listed for each metric.',
    '',
    'Reply with ONLY a JSON object:',
    '{',
    '  "reply": "one or two plain sentences telling the user what you changed",',
    '  "ops": [',
    '    { "op": "add_widget", "section": "<existing section id or a new section title>", "metricId": "...", "title": "...", "type": "...", "width": 6, "params": { "period": "...", "compare": "...", "top": 10 } },',
    '    { "op": "update_widget", "widgetId": "...", "title": "...", "type": "...", "width": 6, "params": { ... } },',
    '    { "op": "remove_widget", "widgetId": "..." }',
    '  ],',
    '  "unsupported": null',
    '}',
    'Only include fields you are setting. Omit params a metric does not accept.',
    'If the user asks for something no metric covers (e.g. a breakdown by region or dimension), set "unsupported" to a short explanation, suggest the closest available metrics in "reply", and return no ops for that part.',
    'If the request is not about the dashboard, return no ops and say so briefly in "reply".',
  ].join('\n')
}

export function describeLayout(spec: DashboardSpec): string {
  const lines = ['Dashboard "' + spec.name + '":']
  for (const s of spec.sections) {
    lines.push('Section id=' + s.id + ' title="' + s.title + '"')
    for (const w of s.widgets) {
      lines.push('  widget id=' + w.id + ' metric=' + w.metricId + ' type=' + w.type + ' width=' + w.width +
        ' title="' + w.title + '" params=' + JSON.stringify(w.params ?? {}))
    }
  }
  return lines.join('\n')
}

export interface AiEditResult {
  ok: boolean
  spec: DashboardSpec
  reply: string
  unsupported: string | null
  applied: number
  rejected: string[]
}

function parseJson(text: string): any {
  const clean = text.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim()
  const start = clean.indexOf('{'), end = clean.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('No JSON in AI reply')
  return JSON.parse(clean.slice(start, end + 1))
}

function pickParams(metricId: string, raw: unknown): MetricParams | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const def = METRICS[metricId]
  const r = raw as Record<string, unknown>
  const p: MetricParams = {}
  if (def.acceptsPeriod && typeof r.period === 'string') p.period = r.period as any
  if (def.acceptsCompare && typeof r.compare === 'string') p.compare = r.compare as any
  if (metricId === 'top_customers' && typeof r.top === 'number') p.top = r.top
  return Object.keys(p).length ? p : undefined
}

function widgetPatch(metricId: string, op: any): Partial<Omit<WidgetSpec, 'id' | 'metricId'>> {
  const patch: Partial<Omit<WidgetSpec, 'id' | 'metricId'>> = {}
  if (typeof op.title === 'string' && op.title.trim()) patch.title = op.title.trim().slice(0, 80)
  if (typeof op.type === 'string' && TYPES_FOR_KIND[METRICS[metricId].kind].includes(op.type)) patch.type = op.type
  if (WIDTHS.includes(op.width)) patch.width = op.width
  const params = pickParams(metricId, op.params)
  if (params) patch.params = params
  return patch
}

function findWidget(spec: DashboardSpec, id: string): WidgetSpec | undefined {
  for (const s of spec.sections) for (const w of s.widgets) if (w.id === id) return w
  return undefined
}

export function applyAiReply(spec: DashboardSpec, aiText: string): AiEditResult {
  let parsed: any
  try { parsed = parseJson(aiText) } catch {
    return { ok: false, spec, reply: 'Sorry — I couldn\'t work out a change for that. Try rephrasing.', unsupported: null, applied: 0, rejected: [] }
  }
  const reply = typeof parsed.reply === 'string' ? parsed.reply.slice(0, 600) : ''
  const unsupported = typeof parsed.unsupported === 'string' && parsed.unsupported.trim() ? parsed.unsupported.slice(0, 400) : null
  const ops: any[] = Array.isArray(parsed.ops) ? parsed.ops.slice(0, 20) : []

  let s = spec
  let applied = 0
  const rejected: string[] = []

  for (const op of ops) {
    try {
      if (op?.op === 'add_widget') {
        const metricId = String(op.metricId ?? '')
        if (!METRICS[metricId]) { rejected.push('Unknown metric "' + metricId + '"'); continue }
        const params = pickParams(metricId, op.params)
        const pErr = validateParams(metricId, params)
        if (pErr.length) { rejected.push(metricId + ': ' + pErr.join('; ')); continue }
        const target = String(op.section ?? '').trim()
        let sec = s.sections.find(x => x.id === target || x.title.toLowerCase() === target.toLowerCase())
        if (!sec) {
          s = addSection(s, target || 'New section')
          sec = s.sections[s.sections.length - 1]
        }
        s = addWidget(s, sec.id, metricId)
        const added = s.sections.find(x => x.id === sec!.id)!.widgets.slice(-1)[0]
        s = updateWidget(s, added.id, widgetPatch(metricId, op))
        applied++
      } else if (op?.op === 'update_widget') {
        const w = findWidget(s, String(op.widgetId ?? ''))
        if (!w) { rejected.push('No widget "' + String(op.widgetId) + '"'); continue }
        const patch = widgetPatch(w.metricId, op)
        if (patch.params) {
          const pErr = validateParams(w.metricId, { ...w.params, ...patch.params })
          if (pErr.length) { rejected.push(w.id + ': ' + pErr.join('; ')); continue }
        }
        if (!Object.keys(patch).length) { rejected.push('Nothing to change on ' + w.id); continue }
        s = updateWidget(s, w.id, patch)
        applied++
      } else if (op?.op === 'remove_widget') {
        const id = String(op.widgetId ?? '')
        if (!findWidget(s, id)) { rejected.push('No widget "' + id + '"'); continue }
        s = removeWidget(s, id)
        applied++
      } else {
        rejected.push('Unknown operation')
      }
    } catch (e: any) {
      rejected.push(e?.message ?? 'Operation failed')
    }
  }

  const v = validateSpec(s)
  if (!v.ok) {
    return { ok: false, spec, reply: 'The suggested changes didn\'t produce a valid dashboard, so nothing was changed.', unsupported, applied: 0, rejected: v.errors }
  }
  return { ok: true, spec: v.spec, reply, unsupported, applied, rejected }
}
