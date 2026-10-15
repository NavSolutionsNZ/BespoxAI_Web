/**
 * lib/corpus/delta.ts
 *
 * Deterministic delta between a customer's C/AL objects and a base corpus.
 * Pure functions — callers supply the base index rows and the tenant object
 * text; nothing here touches the database, git or the AI.
 *
 * Every number in the upgrade readiness report comes from here (and from
 * upgrade-rules.ts), never from a model.
 */

import {
  partHashes, normaliseObject, sha256, versionListOf, isMsTag, isSystemObject,
  PART_HASHES_SCHEMA, type PartHashes, type EntryHashes,
} from './cal-structure'
import { mapToAl, maxEffort, type Effort, type Finding } from './upgrade-rules'

export type Origin = 'standard_unmodified' | 'standard_modified' | 'custom_new' | 'isv_or_unknown'

export interface IdRange { from: number; to: number }
export const DEFAULT_CUSTOM_RANGES: IdRange[] = [{ from: 50000, to: 99999 }]

/** What the delta engine needs from a BaseObject row */
export interface BaseIndexEntry {
  objectType:  string
  objectId:    number
  objectName:  string
  versionList: string | null
  normHash:    string
  partHashes:  PartHashes
}

export interface TenantObjectInput {
  objectType: string
  objectId:   number
  objectName: string
  text:       string
}

export interface KeyDiff { added: string[]; removed: string[]; changed: string[] }

export interface EntryDiff {
  added:      string[]
  removed:    string[]
  defChanged: string[]                                    // definition changed (properties, type, position)
  code:       Array<{ id: string; triggers: string[] }>    // trigger code added/changed/removed
}

export interface ObjectDiff {
  properties:           KeyDiff
  triggers:             KeyDiff
  fields:               EntryDiff
  keys:                 KeyDiff
  controls:             EntryDiff
  actions:              EntryDiff
  procedures:           KeyDiff
  globalsChanged:       boolean
  documentationChanged: boolean
  sections:             KeyDiff
}

export interface ObjectDelta {
  objectType:   string
  objectId:     number
  objectName:   string
  origin:       Origin
  versionList:  string | null
  /** Version-list tokens the customer added on top of the base (e.g. "CUST1.02") */
  modTags:      string[]
  /** Modified standard object with no added version-list tag — possible build noise or untagged change */
  unattributed: boolean
  diff:         ObjectDiff | null
  findings:     Finding[]
  effort:       Effort
}

// ── helpers ──────────────────────────────────────────────────────────────────

export function objectKey(objectType: string, objectId: number): string {
  return objectType.toLowerCase() + ':' + objectId
}

export function inRanges(id: number, ranges: IdRange[]): boolean {
  return ranges.some(r => id >= r.from && id <= r.to)
}

function tokens(versionList: string | null): string[] {
  return (versionList ?? '').split(',').map(t => t.trim()).filter(Boolean)
}

/** Version-list tokens present in the tenant but not the base. Microsoft NAVxx tags never count. */
export function addedVersionTags(tenant: string | null, base: string | null): string[] {
  const have = new Set(tokens(base).map(t => t.toUpperCase()))
  return tokens(tenant).filter(t => !have.has(t.toUpperCase()) && !isMsTag(t))
}

function diffKeys(base: Record<string, string>, tenant: Record<string, string>): KeyDiff {
  const out: KeyDiff = { added: [], removed: [], changed: [] }
  for (const k of Object.keys(tenant)) {
    if (!(k in base)) out.added.push(k)
    else if (base[k] !== tenant[k]) out.changed.push(k)
  }
  for (const k of Object.keys(base)) if (!(k in tenant)) out.removed.push(k)
  return out
}

function diffEntries(base: Record<string, EntryHashes>, tenant: Record<string, EntryHashes>): EntryDiff {
  const out: EntryDiff = { added: [], removed: [], defChanged: [], code: [] }
  for (const id of Object.keys(tenant)) {
    const b = base[id]
    if (!b) { out.added.push(id); continue }
    if (b.def !== tenant[id].def) out.defChanged.push(id)
    const t = diffKeys(b.triggers, tenant[id].triggers)
    const touched = t.added.concat(t.changed, t.removed)
    if (touched.length) out.code.push({ id, triggers: touched })
  }
  for (const id of Object.keys(base)) if (!(id in tenant)) out.removed.push(id)
  return out
}

function emptyKeyDiff(k: KeyDiff): boolean { return !k.added.length && !k.removed.length && !k.changed.length }
function emptyEntryDiff(e: EntryDiff): boolean {
  return !e.added.length && !e.removed.length && !e.defChanged.length && !e.code.length
}

/** Structural diff of two part-hash sets. */
export function diffParts(base: PartHashes, tenant: PartHashes): ObjectDiff {
  return {
    properties:           diffKeys(base.properties, tenant.properties),
    triggers:             diffKeys(base.triggers, tenant.triggers),
    fields:               diffEntries(base.fields, tenant.fields),
    keys:                 diffKeys(base.keys, tenant.keys),
    controls:             diffEntries(base.controls, tenant.controls),
    actions:              diffEntries(base.actions, tenant.actions),
    procedures:           diffKeys(base.procedures, tenant.procedures),
    globalsChanged:       base.globals !== tenant.globals,
    documentationChanged: base.documentation !== tenant.documentation,
    sections:             diffKeys(base.sections, tenant.sections),
  }
}

/** True when the only difference is the documentation trigger (change-log comments). */
export function isDocumentationOnly(d: ObjectDiff): boolean {
  return d.documentationChanged && !d.globalsChanged &&
    emptyKeyDiff(d.properties) && emptyKeyDiff(d.triggers) && emptyKeyDiff(d.keys) &&
    emptyKeyDiff(d.procedures) && emptyKeyDiff(d.sections) &&
    emptyEntryDiff(d.fields) && emptyEntryDiff(d.controls) && emptyEntryDiff(d.actions)
}

// ── per-object delta ─────────────────────────────────────────────────────────

export function computeObjectDelta(
  tenant: TenantObjectInput,
  base: BaseIndexEntry | undefined,
  customRanges: IdRange[] = DEFAULT_CUSTOM_RANGES,
): ObjectDelta {
  const versionList = versionListOf(tenant.text)
  const head = {
    objectType: tenant.objectType, objectId: tenant.objectId, objectName: tenant.objectName, versionList,
  }

  if (!base) {
    const origin: Origin = inRanges(tenant.objectId, customRanges) ? 'custom_new' : 'isv_or_unknown'
    const delta: ObjectDelta = {
      ...head, origin, modTags: addedVersionTags(versionList, null), unattributed: false,
      diff: null, findings: [], effort: 'none',
    }
    delta.findings = mapToAl(delta, customRanges)
    delta.effort = maxEffort(delta.findings)
    return delta
  }

  if (base.partHashes?.schema !== PART_HASHES_SCHEMA) {
    throw new Error('Base index for ' + base.objectType + ' ' + base.objectId +
      ' uses part-hash schema ' + (base.partHashes?.schema ?? 1) + '; re-run ingest-base-corpus.')
  }

  const modTags = addedVersionTags(versionList, base.versionList)
  if (sha256(normaliseObject(tenant.text)) === base.normHash) {
    return { ...head, origin: 'standard_unmodified', modTags, unattributed: false, diff: null, findings: [], effort: 'none' }
  }

  const diff = diffParts(base.partHashes, partHashes(tenant.text))
  const delta: ObjectDelta = {
    ...head, origin: 'standard_modified', modTags, unattributed: modTags.length === 0,
    diff, findings: [], effort: 'none',
  }
  delta.findings = mapToAl(delta, customRanges)
  delta.effort = maxEffort(delta.findings)
  return delta
}

// ── whole-tenant delta ───────────────────────────────────────────────────────

export interface DeltaSummary {
  total:              number
  byOrigin:           Record<Origin, number>
  byEffort:           Record<Effort, number>
  /** Modified standard objects with no added version tag */
  unattributed:       number
  /** Modified standard objects whose only change is the documentation trigger */
  documentationOnly:  number
  findingsByCode:     Record<string, number>
  /** Platform system objects (ID ≥ 2000000000) present in the export and ignored */
  systemExcluded:     number
}

export function computeDeltas(
  tenantObjects: TenantObjectInput[],
  baseIndex: Map<string, BaseIndexEntry>,
  customRanges: IdRange[] = DEFAULT_CUSTOM_RANGES,
): { deltas: ObjectDelta[]; summary: DeltaSummary } {
  const app = tenantObjects.filter(t => !isSystemObject(t.objectId))
  const deltas = app.map(t =>
    computeObjectDelta(t, baseIndex.get(objectKey(t.objectType, t.objectId)), customRanges))

  const summary: DeltaSummary = {
    total: deltas.length,
    byOrigin: { standard_unmodified: 0, standard_modified: 0, custom_new: 0, isv_or_unknown: 0 },
    byEffort: { none: 0, low: 0, medium: 0, high: 0 },
    unattributed: 0, documentationOnly: 0, findingsByCode: {},
    systemExcluded: tenantObjects.length - app.length,
  }
  for (const d of deltas) {
    summary.byOrigin[d.origin]++
    summary.byEffort[d.effort]++
    if (d.unattributed) summary.unattributed++
    if (d.diff && isDocumentationOnly(d.diff)) summary.documentationOnly++
    for (const f of d.findings) summary.findingsByCode[f.code] = (summary.findingsByCode[f.code] ?? 0) + 1
  }
  return { deltas, summary }
}
