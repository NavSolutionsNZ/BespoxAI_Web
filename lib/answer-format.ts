// lib/answer-format.ts — shaping the CFO Assistant's answer for display.
//
// Pure helpers shared by the query route (server) and DataVisualizer (client).

export interface ParsedAnswer {
  answer: string
  displayHint: string
  data: any
}

/**
 * Parse the answerer's reply. It is asked for a single JSON object, but models
 * sometimes wrap it in a code fence or a sentence, or answer in prose only.
 * Fenced or wrapped JSON is extracted; prose with no JSON becomes a plain
 * narrative answer rather than an error. Only an empty reply throws.
 */
export function parseAnswerPayload(raw: string): ParsedAnswer {
  const text = (raw ?? '').trim()
  if (!text) throw new Error('The AI returned an empty answer')

  const unfenced = text.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim()
  const candidates = [unfenced]
  const first = unfenced.indexOf('{'), last = unfenced.lastIndexOf('}')
  if (first >= 0 && last > first) candidates.push(unfenced.slice(first, last + 1))

  for (const c of candidates) {
    try {
      const obj = JSON.parse(c)
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        return {
          answer:      typeof obj.answer === 'string' && obj.answer ? obj.answer : 'No answer generated.',
          displayHint: typeof obj.displayHint === 'string' && obj.displayHint ? obj.displayHint : 'narrative',
          data:        obj.data ?? null,
        }
      }
    } catch { /* try the next candidate */ }
  }
  return { answer: unfenced, displayHint: 'narrative', data: null }
}

/**
 * True for columns that hold identifiers rather than quantities: document and
 * entry numbers, codes, IDs. BC's "No." is a Code field (text) and Entry No. an
 * integer key; neither should get thousands separators ("103,027"). Counts such
 * as "No. of invoices" or "Number of orders" are quantities, not identifiers.
 */
export function isIdentifierHeader(header: unknown): boolean {
  const h = String(header ?? '').trim()
  if (!h) return false
  if (/\b(no\.?|number)\s+of\b/i.test(h)) return false
  return /(^|[^a-z])(no\.?|nos|number|num|code|id)([^a-z]|$)/i.test(h)
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2023-01-26" or "2023-01-26T00:00:00Z" → "26 Jan 2023"; anything else → null. */
export function formatIsoDate(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(T00:00:00(\.0+)?Z?)?$/.exec(value)
  if (!m) return null
  const month = Number(m[2]), day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return day + ' ' + MONTHS_SHORT[month - 1] + ' ' + m[1]
}
