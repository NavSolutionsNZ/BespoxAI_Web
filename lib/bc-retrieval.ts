/**
 * lib/bc-retrieval.ts
 *
 * Tenant-scoped retrieval over the environment object index (TenantObjectFile).
 * This is the query surface behind the AI tool loop (lib/ai-tools.ts):
 * the model asks structural questions, these functions answer them from
 * the customer's actual parsed objects.
 *
 * Design notes:
 *   - All functions are strictly tenant-scoped. tenantId comes from the route
 *     handler's own auth resolution — never from model output.
 *   - Rows are deduped by objectType+objectId (or objectName when no id),
 *     keeping the most recently uploaded version. Environment-level rows
 *     (requirementId=null) and per-requirement rows are searched together.
 *   - whereUsed filters parser-extracted reference summaries in JS. Fine for
 *     the customisation-delta scale this index holds (hundreds of rows, small
 *     summaries). Revisit with a relational reference table if tenants start
 *     holding full base-object exports.
 *
 * Pure helpers (summaryHasCustomisation, referencesTarget, dedupeLatest)
 * are exported separately for unit testing without a database.
 */

import { prisma } from '@/lib/db'

// ── Types ─────────────────────────────────────────────────────────────────────

import {
  summaryHasCustomisation,
  referencesTarget,
  dedupeLatest,
  normType,
  type WhereUsedTarget,
} from '@/lib/bc-retrieval-core'

export { summaryHasCustomisation, referencesTarget, dedupeLatest }
export type { WhereUsedTarget }

export interface ObjectRow {
  id:         string
  objectType: string
  objectId:   number | null
  objectName: string
  language:   string
  summary:    any
  uploadedAt: Date
  requirementId?: string | null
  content?:   string | null
}

const CONTENT_CHAR_LIMIT = 60_000   // ~15k tokens — hard cap per get_object result

// ── DB-backed retrieval ───────────────────────────────────────────────────────

/**
 * Search the tenant's objects by name fragment, object id, and/or type.
 * Returns metadata + summary only — never full content (use getObject).
 */
export async function findObjects(
  tenantId: string,
  opts: { q?: string; objectType?: string; customisedOnly?: boolean; limit?: number } = {},
): Promise<ObjectRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50)
  const q = opts.q?.trim()
  const asId = q && /^\d+$/.test(q) ? parseInt(q) : null

  const where: any = { tenantId }
  if (opts.objectType) where.objectType = { equals: opts.objectType, mode: 'insensitive' }
  if (q) {
    where.OR = [
      { objectName: { contains: q, mode: 'insensitive' } },
      ...(asId != null ? [{ objectId: asId }] : []),
    ]
  }

  const rows: ObjectRow[] = await (prisma as any).tenantObjectFile.findMany({
    where,
    select: {
      id: true, objectType: true, objectId: true, objectName: true,
      language: true, summary: true, uploadedAt: true, requirementId: true,
    },
    orderBy: { uploadedAt: 'desc' },
    take: 500,
  })

  let deduped = dedupeLatest(rows)
  if (opts.customisedOnly) deduped = deduped.filter(r => summaryHasCustomisation(r.summary))
  return deduped.slice(0, limit)
}

/**
 * Fetch a single object with full source content (truncated at CONTENT_CHAR_LIMIT).
 * Matches by objectType + objectId, or objectType + objectName when no id.
 */
export async function getObject(
  tenantId: string,
  opts: { objectType: string; objectId?: number | null; objectName?: string | null },
): Promise<(ObjectRow & { truncated: boolean }) | null> {
  const where: any = {
    tenantId,
    objectType: { equals: opts.objectType, mode: 'insensitive' },
  }
  if (opts.objectId != null) where.objectId = opts.objectId
  else if (opts.objectName) where.objectName = { equals: opts.objectName, mode: 'insensitive' }
  else return null

  const rows: ObjectRow[] = await (prisma as any).tenantObjectFile.findMany({
    where,
    select: {
      id: true, objectType: true, objectId: true, objectName: true,
      language: true, summary: true, uploadedAt: true, requirementId: true, content: true,
    },
    orderBy: { uploadedAt: 'desc' },
    take: 10,
  })
  if (rows.length === 0) return null

  const row = dedupeLatest(rows)[0]
  const content = row.content ?? null
  const truncated = !!content && content.length > CONTENT_CHAR_LIMIT
  return {
    ...row,
    content: truncated ? content!.slice(0, CONTENT_CHAR_LIMIT) : content,
    truncated,
  }
}

/**
 * List objects carrying customisation evidence (mod tags / custom fields),
 * optionally filtered to a specific AP/CR tag or object type.
 */
export async function listCustomisations(
  tenantId: string,
  opts: { tag?: string; objectType?: string; limit?: number } = {},
): Promise<ObjectRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100)
  const where: any = { tenantId }
  if (opts.objectType) where.objectType = { equals: opts.objectType, mode: 'insensitive' }

  const rows: ObjectRow[] = await (prisma as any).tenantObjectFile.findMany({
    where,
    select: {
      id: true, objectType: true, objectId: true, objectName: true,
      language: true, summary: true, uploadedAt: true, requirementId: true,
    },
    orderBy: { uploadedAt: 'desc' },
    take: 1000,
  })

  return dedupeLatest(rows)
    .filter(r => summaryHasCustomisation(r.summary, opts.tag))
    .slice(0, limit)
}

/**
 * Find every stored object whose parsed references point at the target object.
 * Resolves the target's name from the index when only an id is given, so
 * name-based references (AL, TableRelation) still match.
 */
export async function whereUsed(
  tenantId: string,
  target: WhereUsedTarget,
): Promise<{ target: WhereUsedTarget; usedBy: ObjectRow[] }> {
  const resolved: WhereUsedTarget = { ...target }

  // Resolve missing name or id from the index itself when possible
  if (resolved.objectId != null && !resolved.objectName) {
    const t = await getObjectMeta(tenantId, resolved.objectType, resolved.objectId)
    if (t) resolved.objectName = t.objectName
  }

  const rows: ObjectRow[] = await (prisma as any).tenantObjectFile.findMany({
    where: { tenantId },
    select: {
      id: true, objectType: true, objectId: true, objectName: true,
      language: true, summary: true, uploadedAt: true, requirementId: true,
    },
    orderBy: { uploadedAt: 'desc' },
    take: 2000,
  })

  const usedBy = dedupeLatest(rows).filter(r => {
    // An object doesn't "use" itself
    if (normType(r.objectType) === normType(resolved.objectType)
        && r.objectId != null && r.objectId === resolved.objectId) return false
    return referencesTarget(r.summary?.references, resolved)
  })

  return { target: resolved, usedBy }
}

async function getObjectMeta(tenantId: string, objectType: string, objectId: number) {
  return (prisma as any).tenantObjectFile.findFirst({
    where: {
      tenantId,
      objectType: { equals: objectType, mode: 'insensitive' },
      objectId,
    },
    select: { objectName: true },
    orderBy: { uploadedAt: 'desc' },
  })
}

/** Quick inventory stats for a tenant's environment index */
export async function objectInventory(tenantId: string) {
  const rows: ObjectRow[] = await (prisma as any).tenantObjectFile.findMany({
    where: { tenantId },
    select: {
      id: true, objectType: true, objectId: true, objectName: true,
      language: true, summary: true, uploadedAt: true, requirementId: true,
    },
  })
  const deduped = dedupeLatest(rows)

  const byType: Record<string, number> = {}
  for (const r of deduped) byType[r.objectType] = (byType[r.objectType] ?? 0) + 1

  const customised = deduped.filter(r => summaryHasCustomisation(r.summary))
  const tags = new Set<string>()
  for (const r of customised) for (const t of (r.summary?.modTags ?? [])) tags.add(t)

  return {
    totalObjects:     deduped.length,
    byType,
    customisedCount:  customised.length,
    modTags:          Array.from(tags).sort(),
    lastUploadedAt:   deduped.reduce<Date | null>((max, r) => (!max || r.uploadedAt > max ? r.uploadedAt : max), null),
  }
}
