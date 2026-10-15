/**
 * GET /api/agent/object-exports/[jobId]/licence — BCAgent worker fetches the
 * managing partner's developer licence at run time (one fetch per job, only in
 * the job's window). Marks the job running. Returns the raw licence bytes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateJob } from '@/lib/agent-job-auth'
import { licenceFetchRefusal } from '@/lib/corpus/export-jobs'
import { loadLicenceBytes } from '@/lib/licences'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, props: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await props.params
  const job = await authenticateJob(req, jobId)
  if (job instanceof NextResponse) return job

  const refusal = licenceFetchRefusal(job)
  if (refusal) return NextResponse.json({ error: refusal }, { status: 409 })

  // Claim the fetch atomically so a licence is issued at most once per job
  const claimed = await (prisma as any).objectExportJob.updateMany({
    where: { id: jobId, status: 'scheduled', licenceFetchedAt: null },
    data:  { status: 'running', licenceFetchedAt: new Date(), startedAt: new Date() },
  })
  if (claimed.count === 0) return NextResponse.json({ error: 'Licence was already issued for this job.' }, { status: 409 })

  let lic: { bytes: Buffer; sha256: string } | null = null
  try { lic = await loadLicenceBytes(job.licenceOwnerId ?? null) } catch (e: any) {
    await (prisma as any).objectExportJob.update({ where: { id: jobId }, data: { status: 'failed', error: 'Licence could not be read: ' + (e?.message ?? e), finishedAt: new Date() } })
    return NextResponse.json({ error: 'Licence could not be read.' }, { status: 500 })
  }
  if (!lic) {
    await (prisma as any).objectExportJob.update({ where: { id: jobId }, data: { status: 'failed', error: 'The developer licence was removed before the export ran.', finishedAt: new Date() } })
    return NextResponse.json({ error: 'No licence uploaded.' }, { status: 409 })
  }

  return new NextResponse(new Uint8Array(lic.bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Licence-Sha256': lic.sha256,
    },
  })
}
