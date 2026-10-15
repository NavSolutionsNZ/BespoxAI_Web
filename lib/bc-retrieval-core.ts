/**
 * lib/bc-retrieval-core.ts
 *
 * Pure matching/filtering logic for the environment index — no database,
 * no side effects. Kept separate from lib/bc-retrieval.ts (the Prisma-backed
 * layer) so it can be unit tested without a Postgres connection or a
 * generated Prisma client.
 */

import type { ObjectReference } from '@/lib/bc-object-parser'

export interface ObjectRowCore {
  objectType: string
  objectId:   number | null
  objectName: string
  uploadedAt: Date
}

export interface WhereUsedTarget {
  objectType:  string
  objectId?:   number | null
  objectName?: string | null
}

export function normType(t: string): string {
  const lower = (t ?? '').toLowerCase()
  if (lower === 'record') return 'table'
  return lower
}

/** True when a parsed summary shows customisation evidence */
export function summaryHasCustomisation(summary: any, tag?: string): boolean {
  if (!summary) return false
  const hasTags   = Array.isArray(summary.modTags) && summary.modTags.length > 0
  const hasCustom = Array.isArray(summary.customFields) && summary.customFields.length > 0
  if (tag) {
    const t = tag.replace(/\s+/g, '').toUpperCase()
    return Array.isArray(summary.modTags) && summary.modTags.some((m: string) => m.toUpperCase() === t)
  }
  return hasTags || hasCustom
}

/** True when a reference list points at the given target object */
export function referencesTarget(refs: ObjectReference[] | undefined, target: WhereUsedTarget): boolean {
  if (!refs?.length) return false
  const tType = normType(target.objectType)
  const tName = (target.objectName ?? '').trim().toLowerCase()

  return refs.some(r => {
    if (normType(r.objectType) !== tType) return false
    if (target.objectId != null && r.objectId != null) return r.objectId === target.objectId
    if (tName && r.name) return r.name.trim().toLowerCase() === tName
    return false
  })
}

/** Dedupe rows by objectType + objectId (or name), keeping the most recent upload */
export function dedupeLatest<T extends ObjectRowCore>(rows: T[]): T[] {
  const byKey = new Map<string, T>()
  for (const row of rows) {
    const key = `${normType(row.objectType)}|${row.objectId ?? row.objectName.toLowerCase()}`
    const existing = byKey.get(key)
    if (!existing || row.uploadedAt > existing.uploadedAt) byKey.set(key, row)
  }
  return Array.from(byKey.values())
}
