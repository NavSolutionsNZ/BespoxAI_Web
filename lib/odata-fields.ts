// lib/odata-fields.ts — check the planner's OData fields against the page's real
// fields ($metadata) before calling Business Central.
//
// The planner sometimes invents a field (e.g. a customer filter carried over
// from the previous answer). BC answers 400, and a 400 is recorded as a "bad
// query" that blocks the question for 14 days — a good question punished for
// a one-off planner mistake. Unknown fields in $select/$orderby are dropped and
// the query still runs; an unknown field in $filter can't be dropped safely,
// so the caller replies "try rephrasing" without recording a bad query.

const FILTER_WORDS = new Set([
  'eq', 'ne', 'gt', 'ge', 'lt', 'le', 'and', 'or', 'not', 'true', 'false', 'null',
  'contains', 'startswith', 'endswith', 'tolower', 'toupper', 'trim', 'length', 'indexof', 'substring',
])

export interface FieldCheck {
  params: string
  dropped: string[]          // removed from $select / $orderby
  unknownInFilter: string[]  // can't be fixed here
}

function splitParams(params: string): { key: string; value: string; raw: string }[] {
  return params.split('&').filter(Boolean).map(raw => {
    const i = raw.indexOf('=')
    return i < 0 ? { key: raw, value: '', raw } : { key: raw.slice(0, i), value: raw.slice(i + 1), raw }
  })
}

/** Field names used in an OData $filter (quoted strings, keywords, functions and literals excluded). */
export function filterFields(filter: string): string[] {
  const noStrings = filter.replace(/'(?:[^']|'')*'/g, "''")
  const out: string[] = []
  const re = /\b([A-Za-z_][A-Za-z0-9_]*)\b(\s*\()?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(noStrings)) !== null) {
    if (m[2]) continue                                   // function call
    // Date/time literals (2023-01-01T00:00:00Z) never match: their letters sit inside a word.
    if (FILTER_WORDS.has(m[1].toLowerCase())) continue
    if (!out.includes(m[1])) out.push(m[1])
  }
  return out
}

export function checkPlanFields(params: string, actualFields: string[] | undefined | null): FieldCheck {
  if (!params || !actualFields || actualFields.length === 0) return { params, dropped: [], unknownInFilter: [] }
  const known = new Set(actualFields)
  const dropped: string[] = []
  let unknownInFilter: string[] = []
  const parts: string[] = []

  for (const p of splitParams(params)) {
    const key = p.key.toLowerCase()
    if (key === '$select') {
      const fields = p.value.split(',').map(f => f.trim()).filter(Boolean)
      const keep = fields.filter(f => known.has(f))
      fields.filter(f => !known.has(f)).forEach(f => dropped.push(f))
      if (keep.length) parts.push(p.key + '=' + keep.join(','))
      continue
    }
    if (key === '$orderby') {
      const items = p.value.split(',').map(s => s.trim()).filter(Boolean)
      const keep = items.filter(it => known.has(it.split(/\s+/)[0]))
      items.filter(it => !known.has(it.split(/\s+/)[0])).forEach(it => dropped.push(it.split(/\s+/)[0]))
      if (keep.length) parts.push(p.key + '=' + keep.join(','))
      continue
    }
    if (key === '$filter') {
      let value = p.value
      try { value = decodeURIComponent(value) } catch { /* not encoded (e.g. a literal %) */ }
      unknownInFilter = filterFields(value).filter(f => !known.has(f))
    }
    parts.push(p.raw)
  }
  return { params: parts.join('&'), dropped, unknownInFilter }
}

/** Adds fields to an existing $select (only ones the page has); leaves params without $select alone. */
export function ensureSelected(params: string, needed: (string | null | undefined)[], actualFields: string[]): string {
  const known = new Set(actualFields)
  const want = needed.filter((f): f is string => !!f && known.has(f))
  if (!want.length) return params
  return splitParams(params).map(p => {
    if (p.key.toLowerCase() !== '$select') return p.raw
    const have = p.value.split(',').map(f => f.trim()).filter(Boolean)
    const add = want.filter(f => !have.includes(f))
    return add.length ? p.key + '=' + [...have, ...add].join(',') : p.raw
  }).join('&')
}

/**
 * For every selected X_No (Customer_No, Vendor_No, Sell_to_Customer_No…) whose
 * page also has X_Name, select the name too — so tables and charts can show
 * "John Haddock Insurance Co." rather than "30000", whoever builds them.
 */
export function withNameFields(params: string, actualFields: string[] | null | undefined): string {
  if (!actualFields || !actualFields.length) return params
  const sel = splitParams(params).find(p => p.key.toLowerCase() === '$select')
  if (!sel) return params
  const names = sel.value.split(',').map(f => f.trim())
    .filter(f => /_No$/.test(f))
    .map(f => f.replace(/_No$/, '_Name'))
  return ensureSelected(params, names, actualFields)
}
