/**
 * BC/NAV object file parser
 *
 * Supports:
 *   C/AL — .txt exports from NAV 2009 through BC 14 (may contain multiple objects)
 *   AL   — .al extension files from BC 15+ (one object per file by convention)
 *
 * Best-effort: extracts what it can and sets parseError=true on unrecognised input.
 * Raw file content is never stored — only the structured summary.
 */

export interface ParsedObject {
  filename:   string
  objectType: string        // Table, TableExtension, Page, Codeunit, Enum, etc.
  objectId:   number | null
  objectName: string
  language:   'AL' | 'CAL'
  summary:    Record<string, any>
  parseError: boolean
}

// ── Language detection ────────────────────────────────────────────────────────

function detectLanguage(content: string): 'AL' | 'CAL' {
  // C/AL exports always open with "OBJECT <Type> <Id> <Name>"
  return /^OBJECT\s+(Table|Page|Codeunit|Report|XMLport|Dataport|Query|MenuSuite)/im.test(content.trim())
    ? 'CAL'
    : 'AL'
}

// ── Shared extraction helpers (environment index) ────────────────────────────

export interface ObjectReference {
  objectType: string          // Table, Page, Codeunit, Report, XMLport, Query
  objectId?:  number | null   // numeric when known (C/AL is mostly numeric)
  name?:      string | null   // name when the reference is by name (AL, TableRelation)
}

const MAX_REFERENCES = 200

/** Normalise reference type names — Record → Table, casing consistent */
function normRefType(t: string): string {
  const lower = t.toLowerCase()
  if (lower === 'record') return 'Table'
  if (lower === 'xmlport') return 'XMLport'
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

function dedupeReferences(refs: ObjectReference[]): ObjectReference[] {
  const seen = new Set<string>()
  const out: ObjectReference[] = []
  for (const r of refs) {
    const key = `${r.objectType}|${r.objectId ?? ''}|${(r.name ?? '').toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
    if (out.length >= MAX_REFERENCES) break
  }
  return out
}

/**
 * Extract modification tags from source — the Start/Stop AP wrapper convention,
 * bare AP/CR comment tags, and Description= property tags used on field changes.
 * e.g. "// Start AP2378", "//Stop AP2378", "// AP202607", "Description=AP2267"
 */
export function extractModTags(content: string): string[] {
  const tags = new Set<string>()

  // Start/Stop wrappers and bare comment tags: // Start AP2378, //AP2267 etc.
  for (const m of Array.from(content.matchAll(/\/\/+\s*(?:Start\s+|Stop\s+|End\s+)?((?:AP|CR)\s?\d{3,8})/gi))) {
    tags.add(m[1].replace(/\s+/g, '').toUpperCase())
  }
  // C/AL brace comments: { AP2378 ... }
  for (const m of Array.from(content.matchAll(/\{\s*(?:Start\s+|Stop\s+)?((?:AP|CR)\s?\d{3,8})/gi))) {
    tags.add(m[1].replace(/\s+/g, '').toUpperCase())
  }
  // Description= property tags on fields/controls
  for (const m of Array.from(content.matchAll(/Description\s*=\s*"?[^";\n}]*\b((?:AP|CR)\d{3,8})\b/gi))) {
    tags.add(m[1].toUpperCase())
  }
  // Documentation trigger / Version List entries
  for (const m of Array.from(content.matchAll(/Version List\s*=\s*[^;\n]*\b((?:AP|CR)\d{3,8})\b/gi))) {
    tags.add(m[1].toUpperCase())
  }

  return Array.from(tags).sort()
}

/** Extract Version List from C/AL OBJECT-PROPERTIES */
function extractVersionList(block: string): string | null {
  const m = block.match(/Version List\s*=\s*([^;\n]+)/i)
  return m ? m[1].trim() : null
}

/**
 * Extract cross-object references from C/AL source.
 * Covers variable declarations, RunObject, SourceTable, TableRelation,
 * CODEUNIT/REPORT/PAGE.RUN calls, and CalcFormula table names.
 */
function extractCALReferences(block: string): ObjectReference[] {
  const refs: ObjectReference[] = []

  // Variable declarations: Name@1000 : Record 36; / : Codeunit 50009;
  for (const m of Array.from(block.matchAll(/:\s*(Record|Codeunit|Page|Report|XMLport|Query)\s+(\d+)/gi))) {
    refs.push({ objectType: normRefType(m[1]), objectId: parseInt(m[2]) })
  }
  // RunObject=Page 21; RunObject=Report 304;
  for (const m of Array.from(block.matchAll(/RunObject\s*=\s*(Page|Report|Codeunit|XMLport)\s+(\d+)/gi))) {
    refs.push({ objectType: normRefType(m[1]), objectId: parseInt(m[2]) })
  }
  // SourceTable=Table36
  for (const m of Array.from(block.matchAll(/SourceTable\s*=\s*Table(\d+)/gi))) {
    refs.push({ objectType: 'Table', objectId: parseInt(m[1]) })
  }
  // Direct runs: CODEUNIT.RUN(50009), REPORT.RUNMODAL(116, ...), PAGE.RUN(0, ...)
  for (const m of Array.from(block.matchAll(/\b(CODEUNIT|REPORT|PAGE|XMLPORT)\.RUN(?:MODAL)?\s*\(\s*(\d+)/gi))) {
    const id = parseInt(m[2])
    if (id > 0) refs.push({ objectType: normRefType(m[1]), objectId: id })
  }
  // TableRelation="Sales Header" or TableRelation=Customer
  for (const m of Array.from(block.matchAll(/TableRelation\s*=\s*"?([A-Za-z][^";.\n(]*)"?/g))) {
    const name = m[1].trim()
    if (name && !/^\d+$/.test(name)) refs.push({ objectType: 'Table', name })
  }
  // CalcFormula table names: CalcFormula=Sum("Sales Line".Amount)
  for (const m of Array.from(block.matchAll(/CalcFormula\s*=\s*\w+\s*\(\s*"([^".]+)"/gi))) {
    refs.push({ objectType: 'Table', name: m[1].trim() })
  }

  return dedupeReferences(refs)
}

/**
 * Extract cross-object references from AL source.
 * Covers variable declarations, ::"Name" scoped references, and TableRelation.
 */
function extractALReferences(content: string): ObjectReference[] {
  const refs: ObjectReference[] = []

  // Variable declarations: : Record "Sales Line"; / : Codeunit "eDoc. Send";
  for (const m of Array.from(content.matchAll(/:\s*(Record|Codeunit|Page|Report|Query|XmlPort)\s+"?([^";\n]+)"?\s*;/gi))) {
    const name = m[2].trim()
    if (/^\d+$/.test(name)) refs.push({ objectType: normRefType(m[1]), objectId: parseInt(name) })
    else refs.push({ objectType: normRefType(m[1]), name })
  }
  // Scoped enums/objects: Codeunit::"Sales-Post", Page::"Customer Card", Database::"Sales Header"
  for (const m of Array.from(content.matchAll(/\b(Codeunit|Page|Report|Table|Database|Query|XmlPort)::"?([^",;)\n]+)"?/g))) {
    const t = m[1] === 'Database' ? 'Table' : m[1]
    refs.push({ objectType: normRefType(t), name: m[2].trim() })
  }
  // TableRelation = "Item";
  for (const m of Array.from(content.matchAll(/TableRelation\s*=\s*"?([A-Za-z][^";.\n(]*)"?/g))) {
    const name = m[1].trim()
    if (name) refs.push({ objectType: 'Table', name })
  }

  return dedupeReferences(refs)
}

/** Flag custom fields: 50000-range IDs (Webbline convention and general custom range) */
function flagCustomFields(fields: Array<{ id: number; name: string; type: string }> | undefined) {
  if (!fields?.length) return undefined
  const custom = fields.filter(f => f.id >= 50000 && f.id < 100000)
  return custom.length > 0 ? custom : undefined
}

// ── C/AL parsing ──────────────────────────────────────────────────────────────

function splitCALObjects(content: string): string[] {
  // A C/AL export can bundle many objects — split on the OBJECT keyword at line start
  return content.split(/(?=^OBJECT\s)/m).map(s => s.trim()).filter(Boolean)
}

function parseCALObject(block: string, filename: string): ParsedObject {
  const base: ParsedObject = {
    filename, objectType: 'Unknown', objectId: null,
    objectName: filename, language: 'CAL', summary: {}, parseError: true,
  }

  const header = block.match(/^OBJECT\s+(\w+)\s+(\d+)\s+(.+)$/m)
  if (!header) return base

  const objectType = header[1]   // e.g. Table, Codeunit, Page
  const objectId   = parseInt(header[2])
  const objectName = header[3].trim()
  const summary: Record<string, any> = {}

  if (objectType === 'Table') {
    // Fields: { FieldNo ; [Access] ; Name ; DataType [; Properties...] }
    const fieldMatches = Array.from(block.matchAll(/^\s*\{\s*(\d+)\s*;[^;]*;\s*([^;]+?)\s*;\s*([^;}\n]+)/gm))
    summary.fields = fieldMatches
      .map(m => ({ id: parseInt(m[1]), name: m[2].trim(), type: m[3].trim().split(';')[0].trim() }))
      .filter(f => f.id > 0 && f.name)

    // Primary key — first key block
    const keyMatch = block.match(/^\s*\{[^;]*;\s*([^;}\n]+)/m)
    if (keyMatch) summary.primaryKey = keyMatch[1].trim()
  }

  if (objectType === 'Codeunit') {
    // Procedures: PROCEDURE Name@n(params);
    const procMatches = Array.from(block.matchAll(/PROCEDURE\s+(\w+)@\d+\(([^)]*)\)/g))
    summary.procedures = procMatches.map(m => ({
      name:   m[1],
      params: m[2].trim(),
    }))
  }

  if (objectType === 'Page') {
    const srcMatch = block.match(/SourceTable\s*=\s*Table(\d+)/i)
    if (srcMatch) summary.sourceTable = parseInt(srcMatch[1])
    const captMatch = block.match(/CaptionML\s*=\s*ENU\s*=\s*([^;}\n,]+)/i)
    if (captMatch) summary.caption = captMatch[1].trim()
  }

  if (objectType === 'Report') {
    // DataItems: { TableNo ; Name }
    const diMatches = Array.from(block.matchAll(/DataItemTable\s*=\s*Table(\d+)/g))
    summary.dataItems = diMatches.map(m => ({ tableId: parseInt(m[1]) }))
  }

  // ── Environment index enrichment ────────────────────────────────────────
  const versionList = extractVersionList(block)
  if (versionList) summary.versionList = versionList

  const modTags = extractModTags(block)
  if (modTags.length > 0) summary.modTags = modTags

  const references = extractCALReferences(block)
  if (references.length > 0) summary.references = references

  const customFields = flagCustomFields(summary.fields)
  if (customFields) summary.customFields = customFields

  return { filename, objectType, objectId, objectName, language: 'CAL', summary, parseError: false }
}

// ── AL parsing ────────────────────────────────────────────────────────────────

// AL object types we understand
const AL_TYPES = [
  'tableextension', 'table',
  'pageextension',  'page',
  'reportextension','report',
  'enumextension',  'enum',
  'codeunit',
  'xmlport',
  'query',
  'interface',
  'permissionsetextension', 'permissionset',
  'profile',
  'controladdin',
]

function parseALObject(content: string, filename: string): ParsedObject {
  const base: ParsedObject = {
    filename, objectType: 'Unknown', objectId: null,
    objectName: filename, language: 'AL', summary: {}, parseError: true,
  }

  // Match: <type> <id> "<name>" or <type> <id> Name
  const headerRe = new RegExp(
    `^\\s*(${AL_TYPES.join('|')})\\s+(\\d+)\\s+"?([^"\\n{]+)"?`,
    'im'
  )
  const header = content.match(headerRe)
  if (!header) return base

  const rawType   = header[1].toLowerCase()
  const objectType = rawType.charAt(0).toUpperCase() + rawType.slice(1)  // e.g. Tableextension → capitalised
  const objectId   = parseInt(header[2])
  const objectName = header[3].trim().replace(/"/g, '')
  const summary: Record<string, any> = {}

  // Extends — table extensions, page extensions, enum extensions
  const extendsMatch = content.match(/extends\s+"?([^";\n{]+)"?/i)
  if (extendsMatch) summary.extends = extendsMatch[1].trim().replace(/"/g, '')

  // ── Table / TableExtension ──────────────────────────────────────────────
  if (rawType === 'table' || rawType === 'tableextension') {
    // field(id; "Name"; Type) — may span lines
    const fieldMatches = Array.from(content.matchAll(/field\s*\(\s*(\d+)\s*;\s*"?([^";)\n]+)"?\s*;\s*([^)]+)\)/g))
    summary.fields = fieldMatches.map(m => ({
      id:   parseInt(m[1]),
      name: m[2].trim(),
      type: m[3].trim(),
    }))

    // Primary key
    const keyMatch = content.match(/key\s*\(\s*\w+\s*;\s*"?([^";\n)]+)"?\s*\)\s*\{[^}]*Clustered\s*=\s*true/i)
    if (keyMatch) summary.primaryKey = keyMatch[1].trim()
  }

  // ── Codeunit ────────────────────────────────────────────────────────────
  if (rawType === 'codeunit') {
    // procedures and triggers
    const procMatches = Array.from(content.matchAll(/(?:local\s+)?procedure\s+(\w+)\s*\(([^)]*)\)/gi))
    summary.procedures = procMatches.map(m => ({
      name:   m[1],
      params: m[2].trim(),
    }))

    // EventSubscriber attributes — [EventSubscriber(ObjectType::X, X::"Y", 'EventName', ...)]
    const subMatches = Array.from(content.matchAll(
      /\[EventSubscriber\s*\(\s*ObjectType::(\w+)\s*,\s*\w+::"?([^",:)\n]+)"?\s*,\s*'([^']+)'/g
    ))
    if (subMatches.length > 0) {
      summary.eventSubscribers = subMatches.map(m => ({
        objectType: m[1],
        object:     m[2].trim(),
        event:      m[3],
      }))
    }

    // IntegrationEvent / BusinessEvent publishers
    const pubMatches = Array.from(content.matchAll(/\[(?:Integration|Business)Event[^\]]*\]\s*(?:local\s+)?procedure\s+(\w+)/gi))
    if (pubMatches.length > 0) {
      summary.eventPublishers = pubMatches.map(m => m[1])
    }
  }

  // ── Page / PageExtension ────────────────────────────────────────────────
  if (rawType === 'page' || rawType === 'pageextension') {
    const srcMatch = content.match(/SourceTable\s*=\s*"?([^";\n]+)"?/i)
    if (srcMatch) summary.sourceTable = srcMatch[1].trim().replace(/"/g, '')

    // Fields added/modified
    const fieldMatches = Array.from(content.matchAll(/field\s*\(\s*"?([^";)\n]+)"?\s*;\s*(?:Rec\.)?"?([^";\n)]+)"?\s*\)/g))
    if (fieldMatches.length > 0) {
      summary.fieldsAdded = Array.from(new Set(fieldMatches.map(m => m[1].trim().replace(/"/g, ''))))
    }
  }

  // ── Enum / EnumExtension ────────────────────────────────────────────────
  if (rawType === 'enum' || rawType === 'enumextension') {
    const valueMatches = Array.from(content.matchAll(/value\s*\(\s*(\d+)\s*;\s*"?([^";\n)]+)"?\s*\)/gi))
    summary.values = valueMatches.map(m => ({
      id:   parseInt(m[1]),
      name: m[2].trim(),
    }))
  }

  // ── Report / ReportExtension ────────────────────────────────────────────
  if (rawType === 'report' || rawType === 'reportextension') {
    const diMatches = Array.from(content.matchAll(/dataitem\s*\(\s*"?([^";\n))+)"?\s*;\s*"?([^";\n)]+)"?\s*\)/gi))
    summary.dataItems = diMatches.map(m => ({
      name:  m[1].trim(),
      table: m[2].trim(),
    }))
  }

  // ── Environment index enrichment ────────────────────────────────────────
  const modTags = extractModTags(content)
  if (modTags.length > 0) summary.modTags = modTags

  const references = extractALReferences(content)
  if (references.length > 0) summary.references = references

  // In AL, extension objects are custom by construction — flag all their fields;
  // for base-style objects apply the 50000-range rule.
  if (rawType.endsWith('extension') && summary.fields?.length) {
    summary.customFields = summary.fields
  } else {
    const customFields = flagCustomFields(summary.fields)
    if (customFields) summary.customFields = customFields
  }

  return { filename, objectType, objectId, objectName, language: 'AL', summary, parseError: false }
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Parse a BC/NAV object file (C/AL .txt or AL .al).
 * Returns one or more ParsedObject records (C/AL files may contain many objects).
 */
export function parseObjectFile(content: string, filename: string): ParsedObject[] {
  try {
    const lang = detectLanguage(content)

    if (lang === 'CAL') {
      const blocks = splitCALObjects(content)
      if (blocks.length === 0) {
        return [{ filename, objectType: 'Unknown', objectId: null, objectName: filename,
                  language: 'CAL', summary: {}, parseError: true }]
      }
      return blocks.map(b => parseCALObject(b, filename))
    }

    // AL — one object per file by convention; parse as single
    return [parseALObject(content, filename)]

  } catch {
    return [{ filename, objectType: 'Unknown', objectId: null, objectName: filename,
              language: 'AL', summary: {}, parseError: true }]
  }
}

/**
 * Build a compact AI context string from an array of stored object summaries.
 * This is what gets injected into the ai-spec prompt.
 */
export function buildObjectContextSection(objects: Array<{
  objectType: string
  objectId:   number | null
  objectName: string
  language:   string
  summary:    any
}>): string {
  if (objects.length === 0) return ''

  const lines = [
    '\n--- Existing deployed customisations for this tenant ---',
    'The following custom objects are already live in this BC instance.',
    'Field IDs, object numbers, and event subscribers listed here are already in use.',
    'Your spec MUST NOT conflict with these — choose field IDs and object numbers that do not clash.\n',
  ]

  for (const obj of objects) {
    const s = obj.summary ?? {}
    lines.push(`${obj.objectType} ${obj.objectId ?? '(no ID)'} "${obj.objectName}" [${obj.language}]`)

    if (s.extends)              lines.push(`  Extends: ${s.extends}`)
    if (s.sourceTable)          lines.push(`  Source table: ${s.sourceTable}`)
    if (s.primaryKey)           lines.push(`  Primary key: ${s.primaryKey}`)

    if (s.fields?.length)       lines.push(`  Fields: ${s.fields.map((f: any) => `#${f.id} ${f.name} (${f.type})`).join(', ')}`)
    if (s.fieldsAdded?.length)  lines.push(`  Fields added: ${s.fieldsAdded.join(', ')}`)
    if (s.values?.length)       lines.push(`  Values: ${s.values.map((v: any) => v.name).join(', ')}`)
    if (s.dataItems?.length)    lines.push(`  Data items: ${s.dataItems.map((d: any) => d.name ?? d.tableId).join(', ')}`)

    if (s.procedures?.length)   lines.push(`  Procedures: ${s.procedures.map((p: any) => p.name).join(', ')}`)
    if (s.eventPublishers?.length) lines.push(`  Publishes events: ${s.eventPublishers.join(', ')}`)
    if (s.eventSubscribers?.length) {
      const subs = s.eventSubscribers.map((e: any) =>
        typeof e === 'string' ? e : `${e.object}.${e.event}`
      ).join(', ')
      lines.push(`  Subscribes to: ${subs}`)
    }

    lines.push('')
  }

  return lines.join('\n')
}
