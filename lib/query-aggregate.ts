// lib/query-aggregate.ts — exact totals for the CFO Assistant.
//
// The answerer model used to add up the records itself and got it wrong (chat
// said overdue debtors were $2,782,442.01; the exact figure was $3,204,400.99).
// Now the planner says WHAT to total — measures, optional grouping — and this
// module computes it over every fetched record. The answerer is handed the
// finished figures, and the chart/table/KPI data is built from them, so numbers
// shown to the user never come from model arithmetic.

export type AggOp = 'sum' | 'count' | 'avg' | 'min' | 'max'
export type AggPeriod = 'month' | 'quarter' | 'year'

export interface AggMeasure {
  field?: string      // not needed for count
  op: AggOp
  label: string
  negate?: boolean    // e.g. vendor Remaining_Amt_LCY is negative for amounts owed
}

export interface AggSpec {
  groupBy?: string | null
  period?: AggPeriod | null     // group a date field by month / quarter / year
  labelField?: string | null    // display name per group, e.g. Customer_Name for Customer_No
  measures: AggMeasure[]
  sort?: 'desc' | 'asc' | 'key' // by first measure, or by group key (time order)
  top?: number | null
}

export interface AggGroup { key: string; label: string; values: number[] }

export interface AggResult {
  groupLabel: string | null
  measures: AggMeasure[]
  totals: number[]
  groups: AggGroup[]            // empty when not grouped
  recordCount: number
  groupCount: number            // before top
}

const OPS: AggOp[] = ['sum', 'count', 'avg', 'min', 'max']
const PERIODS: AggPeriod[] = ['month', 'quarter', 'year']
const FIELD_RE = /^[A-Za-z0-9_]+$/
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Accepts only a well-formed spec from the planner; anything else → null (no aggregation). */
export function sanitizeAggSpec(raw: unknown): AggSpec | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as any
  const measures: AggMeasure[] = (Array.isArray(r.measures) ? r.measures : [])
    .filter((m: any) => m && OPS.includes(m.op) && (m.op === 'count' || (typeof m.field === 'string' && FIELD_RE.test(m.field))))
    .slice(0, 4)
    .map((m: any) => ({
      field: m.op === 'count' ? undefined : m.field,
      op: m.op as AggOp,
      label: typeof m.label === 'string' && m.label.trim() ? m.label.trim().slice(0, 60) : (m.op === 'count' ? 'Count' : m.op + ' of ' + m.field),
      negate: m.negate === true,
    }))
  if (!measures.length) return null
  const field = (v: unknown) => (typeof v === 'string' && FIELD_RE.test(v) ? v : null)
  const top = Number.isInteger(r.top) && r.top > 0 ? Math.min(r.top, 100) : null
  const period: AggPeriod | null = PERIODS.includes(r.period) ? r.period : null
  return {
    groupBy: field(r.groupBy),
    period,
    labelField: field(r.labelField),
    measures,
    // Time buckets read oldest → newest unless a ranking was asked for.
    sort: r.sort === 'asc' || r.sort === 'desc' || r.sort === 'key' ? r.sort : (period ? 'key' : 'desc'),
    top,
  }
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v)
  return null
}

function periodKey(v: unknown, p: AggPeriod): { key: string; label: string } | null {
  const s = String(v ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s <= '0001-01-01') return null
  const y = s.slice(0, 4), m = Number(s.slice(5, 7))
  if (p === 'year') return { key: y, label: y }
  if (p === 'quarter') { const q = Math.ceil(m / 3); return { key: y + '-Q' + q, label: 'Q' + q + ' ' + y } }
  return { key: y + '-' + String(m).padStart(2, '0'), label: MONTHS[m - 1] + ' ' + y }
}

function finish(op: AggOp, acc: { sum: number; n: number; min: number; max: number }): number {
  if (op === 'count') return acc.n
  if (op === 'sum') return round2(acc.sum)
  if (acc.n === 0) return 0
  if (op === 'avg') return round2(acc.sum / acc.n)
  return round2(op === 'min' ? acc.min : acc.max)
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Computes the spec over all records. */
export function aggregateRecords(records: any[], spec: AggSpec): AggResult {
  type Acc = { sum: number; n: number; min: number; max: number }
  const blank = (): Acc => ({ sum: 0, n: 0, min: Infinity, max: -Infinity })
  const add = (acc: Acc, m: AggMeasure, rec: any) => {
    if (m.op === 'count') { acc.n++; return }
    let v = num(rec?.[m.field!])
    if (v === null) return
    if (m.negate) v = -v
    acc.sum += v; acc.n++
    if (v < acc.min) acc.min = v
    if (v > acc.max) acc.max = v
  }

  const totalAcc = spec.measures.map(blank)
  const groups = new Map<string, { label: string; acc: Acc[] }>()
  const labelField = spec.labelField ?? inferLabelField(records, spec)

  for (const rec of records) {
    spec.measures.forEach((m, i) => add(totalAcc[i], m, rec))
    if (!spec.groupBy) continue
    let key: string, label: string
    if (spec.period) {
      const pk = periodKey(rec?.[spec.groupBy], spec.period)
      if (!pk) continue
      key = pk.key; label = pk.label
    } else {
      key = String(rec?.[spec.groupBy] ?? '')
      const name = labelField ? String(rec?.[labelField] ?? '').trim() : ''
      label = name || key || '(blank)'
    }
    let g = groups.get(key)
    if (!g) { g = { label, acc: spec.measures.map(blank) }; groups.set(key, g) }
    spec.measures.forEach((m, i) => add(g!.acc[i], m, rec))
  }

  let list: AggGroup[] = Array.from(groups.entries()).map(([key, g]) => ({
    key, label: g.label, values: spec.measures.map((m, i) => finish(m.op, g.acc[i])),
  }))
  const groupCount = list.length
  if (spec.sort === 'key') list.sort((a, b) => a.key.localeCompare(b.key))
  else list.sort((a, b) => spec.sort === 'asc' ? a.values[0] - b.values[0] : b.values[0] - a.values[0])
  if (spec.top) list = list.slice(0, spec.top)

  return {
    groupLabel: spec.groupBy ? (spec.period ? spec.period[0].toUpperCase() + spec.period.slice(1) : (labelField ? labelise(labelField) : labelise(spec.groupBy))) : null,
    measures: spec.measures,
    totals: spec.measures.map((m, i) => finish(m.op, totalAcc[i])),
    groups: list,
    recordCount: records.length,
    groupCount,
  }
}

/** Customer_No → Customer_Name, Vendor_No → Vendor_Name (also Sell_to_…/Buy_from_…). */
export function nameFieldFor(groupBy: string): string | null {
  return /_No$/.test(groupBy) ? groupBy.replace(/_No$/, '_Name') : null
}

/** A grouping by a No. field shows the matching Name field when the records carry it. */
function inferLabelField(records: any[], spec: AggSpec): string | null {
  if (!spec.groupBy || spec.period) return null
  const nf = nameFieldFor(spec.groupBy)
  return nf && records.some(r => typeof r?.[nf] === 'string' && r[nf].trim() !== '') ? nf : null
}

/**
 * Before fetching: when grouping by a No. field whose Name field the entity has,
 * make sure the Name is in $select and used as the label.
 */
export function withGroupNames(params: string, spec: AggSpec, entityFields: string[]): { params: string; spec: AggSpec } {
  if (!spec.groupBy || spec.period) return { params, spec }
  // The planner's own labelField only counts if it's a different field the page
  // has (it sometimes repeats the group field, e.g. Customer_No).
  const explicit = spec.labelField && spec.labelField !== spec.groupBy && entityFields.includes(spec.labelField) ? spec.labelField : null
  const nf = explicit ?? nameFieldFor(spec.groupBy)
  if (!nf || !entityFields.includes(nf)) return { params, spec: { ...spec, labelField: null } }
  const sel = /(^|&)\$select=([^&]*)/i.exec(params)
  const out = sel && !sel[2].split(',').map(f => f.trim()).includes(nf)
    ? params.replace(sel[0], sel[1] + '$select=' + sel[2] + ',' + nf)
    : params
  return { params: out, spec: { ...spec, labelField: nf } }
}

function labelise(field: string): string {
  return field.replace(/_/g, ' ').replace(/\bNo\b/, 'No.').trim()
}

/** True for measures that are money (formatted with $). */
export function isMoneyMeasure(m: AggMeasure): boolean {
  return m.op !== 'count' && !!m.field && /amt|amount|lcy|balance|sales|purchase|price|cost|value|profit|revenue/i.test(m.field)
}

export function formatMeasure(m: AggMeasure, v: number): string {
  if (!isMoneyMeasure(m)) return v.toLocaleString('en-NZ', { maximumFractionDigits: 2 })
  const s = '$' + Math.abs(v).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return v < 0 ? '-' + s : s
}

/** Text block for the answerer prompt: the exact figures it must use. */
export function describeAggregate(a: AggResult, possiblyIncomplete: boolean): string {
  const lines: string[] = []
  lines.push('EXACT FIGURES — computed in code over all ' + a.recordCount + ' matching records. Use these numbers verbatim. Do NOT add up, average or count the records yourself.' +
    (possiblyIncomplete ? ' WARNING: the record fetch hit its limit, so these totals may be incomplete — say so.' : ''))
  lines.push('Totals: ' + a.measures.map((m, i) => m.label + ' = ' + formatMeasure(m, a.totals[i])).join('; '))
  if (a.groups.length) {
    lines.push('By ' + (a.groupLabel ?? 'group') + ' (' + a.groupCount + ' groups' + (a.groups.length < a.groupCount ? ', top ' + a.groups.length + ' shown' : '') + '):')
    for (const g of a.groups) lines.push('  - ' + g.label + (g.label !== g.key ? ' [' + g.key + ']' : '') + ': ' + a.measures.map((m, i) => m.label + ' ' + formatMeasure(m, g.values[i])).join(', '))
  }
  return lines.join('\n')
}

/**
 * The structured data to show, built from the exact figures so the chart/table/
 * KPIs can't drift from them. Returns null to keep the answerer's own data.
 */
export function aggregateDisplayData(a: AggResult, displayHint: string): any | null {
  if (a.groups.length && (displayHint === 'table' || displayHint === 'bar_chart' || displayHint === 'line_chart')) {
    return {
      columns: [a.groupLabel ?? 'Group', ...a.measures.map(m => m.label)],
      rows: a.groups.map(g => [g.label, ...g.values]),
    }
  }
  if (displayHint === 'kpi' || !a.groups.length) {
    return {
      kpis: a.measures.map((m, i) => ({
        label: m.label,
        value: formatMeasure(m, a.totals[i]),
        subtext: a.recordCount + ' record' + (a.recordCount === 1 ? '' : 's') + (a.groups.length ? ' · ' + a.groupCount + ' ' + (a.groupLabel ?? 'groups').toLowerCase() : ''),
      })),
    }
  }
  return null
}

/**
 * Where the name for a grouped No. field lives when the records themselves
 * don't carry it. BC14's Cust./Vendor Ledger Entry have a Customer_Name /
 * Vendor_Name field, but entries posted before it existed (e.g. all CRONUS
 * demo data) leave it blank — so look the name up on the master record.
 */
export const NAME_SOURCES: Record<string, { logical: string; nameField: string }> = {
  Customer_No:          { logical: 'Customer', nameField: 'Name' },
  Sell_to_Customer_No:  { logical: 'Customer', nameField: 'Name' },
  Bill_to_Customer_No:  { logical: 'Customer', nameField: 'Name' },
  Vendor_No:            { logical: 'Vendor', nameField: 'Name' },
  Buy_from_Vendor_No:   { logical: 'Vendor', nameField: 'Name' },
  Pay_to_Vendor_No:     { logical: 'Vendor', nameField: 'Name' },
  Item_No:              { logical: 'Item', nameField: 'Description' },
  Bank_Account_No:      { logical: 'BankAccount', nameField: 'Name' },
}

/** Keys of the shown groups that still have no name (label is just the key). */
export function unnamedGroupKeys(a: AggResult): string[] {
  return a.groups.filter(g => g.key && g.label === g.key).map(g => g.key)
}

/** Relabels unnamed groups from a No. → name map; returns the same object. */
export function applyGroupNames(a: AggResult, names: Map<string, string>, groupLabel?: string): AggResult {
  let changed = false
  for (const g of a.groups) {
    const n = names.get(g.key)?.trim()
    if (g.label === g.key && n) { g.label = n; changed = true }
  }
  if (changed && groupLabel) a.groupLabel = groupLabel
  return a
}

/** OData filter selecting master records by No.: "No eq 'A' or No eq 'B'". */
export function noFilter(keys: string[], keyField = 'No'): string {
  return keys.map(k => keyField + " eq '" + k.replace(/'/g, "''") + "'").join(' or ')
}
