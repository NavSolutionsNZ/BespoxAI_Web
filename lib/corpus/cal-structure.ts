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

/**
 * Platform system objects (ID 2000000000 and up — e.g. codeunits 2000000001
 * "Version Triggers" … 2000000010 "Extension Triggers", system tables).
 * Customers can't change them, developer licences often can't export them as
 * text, and they play no part in a C/AL → AL upgrade, so they're excluded from
 * corpora, exports and deltas.
 */
export const SYSTEM_ID_START = 2000000000
export const LAST_APPLICATION_ID = SYSTEM_ID_START - 1
export function isSystemObject(objectId: number): boolean {
  return objectId >= SYSTEM_ID_START
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

/** Bump when the PartHashes shape changes — stale index rows must be re-ingested. */
export const PART_HASHES_SCHEMA = 2

/** One field / control / action: its definition and its trigger code, hashed apart. */
export interface EntryHashes {
  def:      string                    // entry with trigger bodies removed
  triggers: Record<string, string>    // OnValidate, OnLookup, OnAction …
}

export interface PartHashes {
  schema:        number
  /** Object-level PROPERTIES that are not triggers or the action list */
  properties:    Record<string, string>
  /** Object-level triggers (OnInsert, OnRun, OnOpenPage …) */
  triggers:      Record<string, string>
  /** FIELDS by field number */
  fields:        Record<string, EntryHashes>
  /** KEYS, keyed by the key's field list */
  keys:          Record<string, string>
  /** CONTROLS by control id (pages, forms, request pages) */
  controls:      Record<string, EntryHashes>
  /** Page ActionList entries by action id */
  actions:       Record<string, EntryHashes>
  /** CODE: global VAR block */
  globals:       string | null
  /** CODE: one hash per procedure, keyed by name */
  procedures:    Record<string, string>
  /** CODE: the documentation trigger at the end of the object */
  documentation: string | null
  /** Any other section (FIELDGROUPS, DATASET, ELEMENTS, LABELS, RDLDATA …) as a whole */
  sections:      Record<string, string>
}

/** Split a body on lines that start at exactly `indent` spaces followed by `{` */
function splitEntries(body: string, indent: number): string[] {
  const re = new RegExp('(?=^' + ' '.repeat(indent) + '\\{)', 'm')
  return body.split(re).filter(s => s.trim().startsWith('{'))
}

/**
 * Separate trigger bodies from an entry. A C/AL trigger is "OnXxx=" followed by
 * an optional VAR block and BEGIN; it ends at the "END;" that sits in the same
 * column as its BEGIN (inner END;s are always indented further).
 */
export function splitTriggers(entry: string): { def: string; triggers: Record<string, string> } {
  const lines = entry.split('\n')
  const keep: string[] = []
  const triggers: Record<string, string> = {}
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const t = line.match(/\b(On[A-Za-z]+)=(?=\s*(BEGIN|VAR)\b|\s*$)/)
    if (!t || t.index === undefined) { keep.push(line); i++; continue }

    // locate BEGIN (same line or a following line) and its column
    let bLine = -1, bCol = -1
    for (let j = i; j < lines.length; j++) {
      const from = j === i ? t.index + t[0].length : 0
      const k = lines[j].slice(from).search(/\bBEGIN\b/)
      if (k >= 0) { bLine = j; bCol = from + k; break }
    }
    if (bLine < 0) { keep.push(line); i++; continue }

    const endRe = new RegExp('^ {' + bCol + '}END;')
    let eLine = -1
    for (let j = bLine + (lines[bLine].slice(bCol).match(/^BEGIN\s+END;/) ? 0 : 1); j < lines.length; j++) {
      if (j === bLine) { eLine = j; break }               // "BEGIN END;" on one line
      if (endRe.test(lines[j])) { eLine = j; break }
    }
    if (eLine < 0) { keep.push(line); i++; continue }

    const body = [line.slice(t.index)].concat(lines.slice(i + 1, eLine + 1)).join('\n')
    let key = t[1]
    while (triggers[key] !== undefined) key += '~'
    triggers[key] = sha256(body.trim())

    // keep the text before the trigger and anything after its END; on the last line
    keep.push(line.slice(0, t.index) + '<' + t[1] + '>' + lines[eLine].replace(/^.*?END;/, ''))
    i = eLine + 1
  }
  return { def: keep.join('\n'), triggers }
}

function entryHashes(entry: string): EntryHashes {
  // keep leading indentation: trigger END; is matched by column
  const { def, triggers } = splitTriggers(entry.replace(/\s+$/, ''))
  return { def: sha256(def.trim()), triggers }
}

function entriesById(body: string, indent = 4): Record<string, EntryHashes> {
  const out: Record<string, EntryHashes> = {}
  for (const entry of splitEntries(body, indent)) {
    const id = entry.match(/^\s*\{\s*(\d+)/)
    if (id) out[id[1]] = entryHashes(entry)
  }
  return out
}

function keysByFields(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of splitEntries(body, 4)) {
    const f = entry.match(/^\s*\{[^;]*;([^;}]+)/)
    if (f) out[f[1].trim()] = sha256(entry.trim())
  }
  return out
}

function propertiesByName(body: string): Pick<PartHashes, 'properties' | 'triggers' | 'actions'> {
  const properties: Record<string, string> = {}
  const triggers: Record<string, string> = {}
  let actions: Record<string, EntryHashes> = {}
  // a new property starts with a letter at 4 spaces; "    {" / "    }" lines belong to ActionList
  for (const chunk of body.split(/(?=^    [A-Za-z])/m)) {
    const name = chunk.match(/^    ([A-Za-z][\w ]*?)\s*=/)
    if (!name) continue
    if (/^On[A-Z]/.test(name[1])) triggers[name[1]] = sha256(chunk.trim())
    else if (name[1] === 'ActionList') {
      // action entries sit deeper than 4 spaces; split on any "{ <id>" line start
      const inner = chunk.split(/(?=^\s+\{\s*\d+\s*;)/m).filter(s => /^\s+\{\s*\d+\s*;/.test(s))
      actions = {}
      for (const e of inner) {
        const id = e.match(/\{\s*(\d+)/)
        if (id) actions[id[1]] = entryHashes(e.replace(/\n\s*\}\s*$/, ''))
      }
    }
    else properties[name[1]] = sha256(chunk.trim())
  }
  return { properties, triggers, actions }
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
    schema: PART_HASHES_SCHEMA,
    properties: {}, triggers: {}, fields: {}, keys: {}, controls: {}, actions: {},
    globals: null, procedures: {}, documentation: null, sections: {},
  }
  for (const [name, body] of Array.from(sections.entries())) {
    switch (name) {
      case 'OBJECT-PROPERTIES': break
      case 'PROPERTIES': Object.assign(out, propertiesByName(body)); break
      case 'FIELDS':     out.fields   = entriesById(body); break
      case 'KEYS':       out.keys     = keysByFields(body); break
      case 'CONTROLS':   out.controls = entriesById(body); break
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

/** A parsed Microsoft version-list tag: NAVAPAC14.23 → { family: 'APAC', major: 14, minor: 23 } */
export interface MsTag { family: string; major: number; minor: number | null }

/**
 * Microsoft version-list tags are NAV + localisation family + version, e.g.
 * NAVW114.27 (W1, BC14 CU27), NAVAPAC14.23 (Asia-Pacific), NAVNZ14.00, NAVW16.00 (NAV 2009).
 * W1 is matched first because its "1" would otherwise be read as part of the version.
 */
export function parseMsTag(token: string): MsTag | null {
  const m = token.trim().match(/^NAV(W1|[A-Z]+?)(\d+)(?:\.(\d+))?/i)
  if (!m) return null
  return { family: m[1].toUpperCase(), major: parseInt(m[2], 10), minor: m[3] !== undefined ? parseInt(m[3], 10) : null }
}

export function isMsTag(token: string): boolean { return parseMsTag(token) !== null }

export interface VersionTags {
  /** Dominant W1 tag at major-version level, e.g. NAVW114 */
  w1:      string | null
  /** Dominant non-W1 family at the same major, e.g. NAVAPAC14 */
  local:   string | null
  /** Other non-W1 families present at that major, most frequent first, e.g. [NAVNZ14] */
  others:  string[]
  /** Highest W1 minor at that major — the cumulative-update level (14.27 → 27) */
  cuLevel: number | null
}

/**
 * Dominant Microsoft tags across a set of version lists. Tags are compared at
 * major-version level because the minor part is the CU, which varies per object.
 */
export function dominantVersionTags(versionLists: Array<string | null>): VersionTags {
  const w1Major = new Map<number, number>()
  const localByMajor = new Map<number, Map<string, number>>()
  const cuByMajor = new Map<number, number>()

  for (const vl of versionLists) {
    if (!vl) continue
    for (const raw of vl.split(',')) {
      const t = parseMsTag(raw)
      if (!t) continue
      if (t.family === 'W1') {
        w1Major.set(t.major, (w1Major.get(t.major) ?? 0) + 1)
        if (t.minor !== null) cuByMajor.set(t.major, Math.max(cuByMajor.get(t.major) ?? 0, t.minor))
      } else {
        const m = localByMajor.get(t.major) ?? new Map<string, number>()
        m.set(t.family, (m.get(t.family) ?? 0) + 1)
        localByMajor.set(t.major, m)
      }
    }
  }

  const ranked = <K>(m: Map<K, number>) => Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(e => e[0])
  const major = ranked(w1Major)[0] ?? ranked(new Map(Array.from(localByMajor.entries()).map(([k, v]) => [k, Array.from(v.values()).reduce((x, y) => x + y, 0)])))[0]
  if (major === undefined) return { w1: null, local: null, others: [], cuLevel: null }

  const families = ranked(localByMajor.get(major) ?? new Map<string, number>())
  return {
    w1:      w1Major.has(major) ? 'NAVW1' + major : null,
    local:   families[0] ? 'NAV' + families[0] + major : null,
    others:  families.slice(1).map(f => 'NAV' + f + major),
    cuLevel: cuByMajor.get(major) ?? null,
  }
}

/** The tag a corpus is keyed on: W1 corpora by the W1 tag, others by the dominant local family. */
export function corpusVersionTag(tags: VersionTags, localisation: string): string | null {
  return localisation.toUpperCase() === 'W1' ? tags.w1 : (tags.local ?? tags.w1)
}

/** True when the export's tags are consistent with a localisation label (e.g. NZ under APAC). */
export function tagsMatchLocalisation(tags: VersionTags, localisation: string): boolean {
  const loc = localisation.toUpperCase()
  if (loc === 'W1') return !tags.local
  return [tags.local].concat(tags.others).some(t => !!t && parseMsTag(t)?.family === loc)
}
