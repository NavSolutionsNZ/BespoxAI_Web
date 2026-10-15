/**
 * lib/corpus/cal-structure.ts
 *
 * Deterministic structure, normalisation and hashing for C/AL text exports.
 * Used by both base-corpus ingest and (later) the tenant delta engine, so the
 * two sides are always hashed the same way.
 *
 * Pure functions only — no database, no filesystem.
 *
 * Encoding: C/AL .txt exports are written in the OEM code page, not UTF-8.
 * Callers must read and write them as 'latin1' so bytes round-trip unchanged.
 */

import { createHash } from 'crypto'

// ── Splitting a multi-object export ──────────────────────────────────────────

export interface CalObjectBlock {
  objectType: string
  objectId:   number
  objectName: string
  text:       string        // exact text of this object, CRLF/LF preserved
}

const OBJECT_HEADER = /^OBJECT\s+(\w+)\s+(\d+)\s+(.+?)\s*$/m

/**
 * Split a full export into one block per object. Splits only on "OBJECT"
 * at column 0 — code inside objects is always indented, so it cannot match.
 */
export function splitCalExport(content: string): CalObjectBlock[] {
  const parts = content.split(/(?=^OBJECT\s)/m)
  const out: CalObjectBlock[] = []
  for (const part of parts) {
    const m = part.match(OBJECT_HEADER)
    if (!m || part.search(OBJECT_HEADER) !== 0) continue
    out.push({
      objectType: m[1],
      objectId:   parseInt(m[2], 10),
      objectName: m[3],
      text:       part,
    })
  }
  return out
}

const FILE_PREFIX: Record<string, string> = {
  table: 'TAB', page: 'PAG', form: 'FOR', codeunit: 'COD', report: 'REP',
  xmlport: 'XML', dataport: 'DAT', query: 'QUE', menusuite: 'MEN',
}

/** Conventional C/SIDE file name for one object, e.g. Table 18 → TAB18.TXT */
export function objectFileName(objectType: string, objectId: number): string {
  const prefix = FILE_PREFIX[objectType.toLowerCase()]
  if (!prefix) throw new Error('Unknown C/AL object type: ' + objectType)
  return prefix + objectId + '.TXT'
}

// ── Top-level sections ───────────────────────────────────────────────────────

/**
 * Top-level sections of an object: OBJECT-PROPERTIES, PROPERTIES, FIELDS,
 * KEYS, FIELDGROUPS, CONTROLS, CODE, DATASET, REQUESTPAGE, ELEMENTS, LABELS,
 * RDLDATA, MENUNODES … Each is a 2-space-indented name line followed by a
 * "  {" … "  }" body. Returns the body lines (without the braces).
 */
export function calSections(text: string): Map<string, string> {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const sections = new Map<string, string>()
  let i = 0
  while (i < lines.length) {
    const name = lines[i].match(/^  ([A-Z][A-Z-]+)\s*$/)
    if (name && lines[i + 1] !== undefined && /^  \{\s*$/.test(lines[i + 1])) {
      const body: string[] = []
      let j = i + 2
      while (j < lines.length && !/^  \}\s*$/.test(lines[j])) { body.push(lines[j]); j++ }
      sections.set(name[1], body.join('\n'))
      i = j + 1
      continue
    }
    i++
  }
  return sections
}

// ── Normalisation ────────────────────────────────────────────────────────────

/** Line endings to LF, trailing whitespace removed. Nothing else changes. */
export function normaliseText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(l => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '\n')
}

/**
 * Normalised object text for comparison: OBJECT-PROPERTIES (Date, Time,
 * Modified, Version List) removed; comments are deliberately kept, because
 * commented-out standard code is still a modification.
 */
export function normaliseObject(text: string): string {
  const norm = normaliseText(text)
  return norm.replace(/^  OBJECT-PROPERTIES\n  \{\n[\s\S]*?^  \}\n/m, '')
}

export function sha256(s: string): string {
  return createHash('sha256').update(s, 'latin1').digest('hex')
}

// ── Part hashes ──────────────────────────────────────────────────────────────

export interface PartHashes {
  /** Object-level PROPERTIES, one hash per property (triggers included, e.g. OnRun) */
  properties:    Record<string, string>
  /** FIELDS by field number (field triggers included in the entry) */
  fields:        Record<string, string>
  /** CONTROLS by control id (pages/forms/request pages) */
  controls:      Record<string, string>
  /** CODE: global VAR block */
  globals:       string | null
  /** CODE: one hash per procedure, keyed by name */
  procedures:    Record<string, string>
  /** CODE: the documentation trigger at the end of the object */
  documentation: string | null
  /** Any other section (KEYS, FIELDGROUPS, DATASET, ELEMENTS, LABELS, RDLDATA …) as a whole */
  sections:      Record<string, string>
}

/** Split a body on lines that start at exactly `indent` spaces followed by `{` */
function splitEntries(body: string, indent: number): string[] {
  const re = new RegExp('(?=^' + ' '.repeat(indent) + '\\{)', 'm')
  return body.split(re).filter(s => s.trim().startsWith('{'))
}

function entriesById(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of splitEntries(body, 4)) {
    const id = entry.match(/^\s*\{\s*(\d+)/)
    if (id) out[id[1]] = sha256(entry.trim())
  }
  return out
}

function propertiesByName(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const chunk of body.split(/(?=^    \S)/m)) {
    const name = chunk.match(/^    ([A-Za-z][\w ]*?)\s*=/)
    if (name) out[name[1]] = sha256(chunk.trim())
  }
  return out
}

const PROC_START = /(?=^    (?:\[[^\n]*\]\n    )*(?:LOCAL )?PROCEDURE )/m

function splitCode(body: string): Pick<PartHashes, 'globals' | 'procedures' | 'documentation'> {
  let rest = body
  let documentation: string | null = null

  // Documentation trigger: the LAST "    BEGIN" before the closing "    END."
  // (procedure bodies also open with "    BEGIN", so the first match is wrong).
  const endDot = rest.search(/^    END\.[ \t]*$/m)
  if (endDot >= 0) {
    const begin = rest.lastIndexOf('\n    BEGIN\n', endDot)
    const start = begin >= 0 ? begin + 1 : (rest.startsWith('    BEGIN\n') ? 0 : -1)
    if (start >= 0) {
      const endLine = rest.indexOf('\n', endDot)
      const stop = endLine >= 0 ? endLine : rest.length
      documentation = sha256(rest.slice(start, stop).trim())
      rest = rest.slice(0, start) + rest.slice(stop)
    }
  }

  const chunks = rest.split(PROC_START)
  let globals: string | null = null
  const procedures: Record<string, string> = {}

  for (const chunk of chunks) {
    const name = chunk.match(/PROCEDURE\s+("[^"]+"|[^@(\s]+)/)
    if (!name) {
      if (chunk.trim()) globals = sha256(chunk.trim())
      continue
    }
    let key = name[1].replace(/^"|"$/g, '')
    while (procedures[key] !== undefined) key += '~'   // overloads stay distinct
    procedures[key] = sha256(chunk.trim())
  }
  return { globals, procedures, documentation }
}

/** Part-level hashes so the delta engine can say *what* changed, not just *that* it changed. */
export function partHashes(text: string): PartHashes {
  const sections = calSections(normaliseText(text))
  const out: PartHashes = {
    properties: {}, fields: {}, controls: {},
    globals: null, procedures: {}, documentation: null, sections: {},
  }
  for (const [name, body] of Array.from(sections.entries())) {
    switch (name) {
      case 'OBJECT-PROPERTIES': break
      case 'PROPERTIES': out.properties = propertiesByName(body); break
      case 'FIELDS':     out.fields     = entriesById(body); break
      case 'CONTROLS':   out.controls   = entriesById(body); break
      case 'CODE':       Object.assign(out, splitCode(body)); break
      default:           out.sections[name] = sha256(body)
    }
  }
  return out
}

// ── Version list ─────────────────────────────────────────────────────────────

export function versionListOf(text: string): string | null {
  const m = text.match(/Version List\s*=\s*([^;\r\n]*);/i)
  return m ? m[1].trim() : null
}

/**
 * Dominant Microsoft version tag across a set of version lists,
 * e.g. ["NAVW114.00,NAVNZ14.00", …] → { w1: "NAVW114.00", local: "NAVNZ14.00" }.
 * Tags are compared on their major.minor (NAVW114.00.29537 → NAVW114.00).
 */
export function dominantVersionTags(versionLists: Array<string | null>): { w1: string | null; local: string | null } {
  const w1 = new Map<string, number>()
  const local = new Map<string, number>()
  for (const vl of versionLists) {
    if (!vl) continue
    for (const raw of vl.split(',')) {
      const t = raw.trim().match(/^NAV([A-Z][A-Z0-9])(\d+\.\d+)/i)
      if (!t) continue
      const tag = 'NAV' + t[1].toUpperCase() + t[2]
      const bucket = t[1].toUpperCase() === 'W1' ? w1 : local
      bucket.set(tag, (bucket.get(tag) ?? 0) + 1)
    }
  }
  const top = (m: Map<string, number>) =>
    Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  return { w1: top(w1), local: top(local) }
}
