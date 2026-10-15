/**
 * lib/corpus/process-export.ts
 *
 * Server-side processing of an uploaded full export (design §14.4):
 * chunks → gunzip → delta vs base corpus → TenantObjectDelta rows →
 * changed objects committed to the tenant repo → job summary.
 * Runs after the agent's completion callback (via next/server `after`).
 */

import { prisma } from '@/lib/db'
import { ensureRepo, resolvePartnerToken, commitPrefixSnapshot } from '@/lib/github'
import { DEFAULT_CUSTOM_RANGES } from './delta'
import { assembleChunks, parseRepoOverride, FULL_EXPORT_BRANCH, FULL_EXPORT_PREFIX } from './export-jobs'
import { decodeExport, processExportText, tenantCustomRanges, type ProcessIO } from './process-export-core'
import { objectFileName, type PartHashes } from './cal-structure'

const db = prisma as any

const io: ProcessIO = {
  corpora: async () => db.baseCorpus.findMany({
    where:  { status: 'ready' },
    select: { id: true, version: true, build: true, localisation: true, versionTag: true, status: true },
  }),
  baseLite: async (corpusId: string) => db.baseObject.findMany({
    where:  { corpusId },
    select: { id: true, objectType: true, objectId: true, objectName: true, versionList: true, normHash: true },
  }),
  basePartHashes: async (ids: string[]) => {
    const out = new Map<string, PartHashes>()
    const BATCH = 500
    for (let i = 0; i < ids.length; i += BATCH) {
      const rows = await db.baseObject.findMany({
        where:  { id: { in: ids.slice(i, i + BATCH) } },
        select: { id: true, partHashes: true },
      })
      for (const r of rows) out.set(r.id, r.partHashes as PartHashes)
    }
    return out
  },
}

async function resolveTenantRepo(tenant: any): Promise<{ owner: string; repo: string; token: string | null }> {
  const token = await resolvePartnerToken(tenant.partnerAccount?.githubToken)
  const override = parseRepoOverride(tenant.githubRepoOverride)
  if (override) return { ...override, token }
  if (tenant.githubOrg && tenant.githubRepo) return { owner: tenant.githubOrg, repo: tenant.githubRepo, token }
  const r = await ensureRepo(tenant.name, tenant.partnerAccount?.githubOrg || tenant.githubOrg || undefined, token)
  return { owner: r.owner, repo: r.repo, token }
}

export async function processExportJob(jobId: string): Promise<void> {
  const claimed = await db.objectExportJob.updateMany({
    where: { id: jobId, status: 'uploaded' },
    data:  { status: 'processing' },
  })
  if (claimed.count === 0) return   // already processed, or not ready

  try {
    const job = await db.objectExportJob.findFirst({ where: { id: jobId } })
    const tenant = await db.tenant.findFirst({
      where:  { id: job.tenantId },
      select: {
        id: true, name: true, customIdRanges: true, githubOrg: true, githubRepo: true, githubRepoOverride: true,
        partnerAccount: { select: { githubOrg: true, githubToken: true } },
      },
    })
    if (!tenant) throw new Error('Tenant no longer exists.')

    const chunks = await db.objectExportChunk.findMany({ where: { jobId }, select: { seq: true, data: true } })
    const text = decodeExport(assembleChunks(chunks, job.chunkCount ?? chunks.length))
    const ranges = tenantCustomRanges(tenant.customIdRanges, DEFAULT_CUSTOM_RANGES)

    const result = await processExportText(text, io, ranges)
    const corpusId = result.match.corpus!.id

    // Replace this tenant's deltas with this export's (only objects that differ from the base)
    const rows = result.deltas
      .filter(d => d.origin !== 'standard_unmodified')
      .map(d => ({
        tenantId: tenant.id, jobId, corpusId,
        objectType: d.objectType, objectId: d.objectId, objectName: d.objectName,
        origin: d.origin, versionList: d.versionList, modTags: d.modTags, unattributed: d.unattributed,
        diff: d.diff as any, findings: d.findings as any, effort: d.effort,
        filePath: FULL_EXPORT_PREFIX + objectFileName(d.objectType, d.objectId),
      }))
    await db.$transaction(async (tx: any) => {
      await tx.tenantObjectDelta.deleteMany({ where: { tenantId: tenant.id } })
      for (let i = 0; i < rows.length; i += 500) await tx.tenantObjectDelta.createMany({ data: rows.slice(i, i + 500) })
    }, { timeout: 60_000 })

    // Commit changed objects. A repo failure doesn't lose the analysis — it's recorded as a warning.
    let repoOwner: string | null = null, repoName: string | null = null, commitSha: string | null = null
    let repoWarning: string | null = null, commitStats = { added: 0, updated: 0, removed: 0 }
    try {
      const r = await resolveTenantRepo(tenant)
      repoOwner = r.owner; repoName = r.repo
      const c = await commitPrefixSnapshot(
        r.owner, r.repo, FULL_EXPORT_BRANCH, FULL_EXPORT_PREFIX, result.files,
        'Full object export ' + new Date().toISOString().slice(0, 10) + ': ' + result.files.length + ' objects differ from ' +
          result.match.corpus!.version + ' ' + result.match.corpus!.localisation + ' ' + result.match.corpus!.build,
        r.token,
      )
      commitSha = c.commitSha
      commitStats = { added: c.added, updated: c.updated, removed: c.removed }
    } catch (e: any) {
      repoWarning = 'Analysis saved, but committing objects to the tenant repo failed: ' + (e?.message ?? e)
    }

    await db.objectExportJob.update({
      where: { id: jobId },
      data: {
        status: 'complete', finishedAt: new Date(),
        corpusId, matchConfidence: result.match.confidence,
        summary: {
          ...result.summary,
          corpus: { id: corpusId, version: result.match.corpus!.version, build: result.match.corpus!.build, localisation: result.match.corpus!.localisation },
          matchReason: result.match.reason,
          detected: result.match.detected,
          filesCommitted: result.files.length,
          commit: commitStats,
          noChanges: commitSha === null && !repoWarning,
        } as any,
        repoOwner, repoName, exportCommit: commitSha,
        error: [job.error, repoWarning].filter(Boolean).join(' ') || null,   // keep any licence-restore warning
      },
    })
  } catch (e: any) {
    await db.objectExportJob.update({
      where: { id: jobId },
      data:  { status: 'failed', finishedAt: new Date(), error: 'Processing failed: ' + (e?.message ?? String(e)) },
    })
  } finally {
    await db.objectExportChunk.deleteMany({ where: { jobId } }).catch(() => {})
  }
}
