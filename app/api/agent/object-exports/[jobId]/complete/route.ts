/**
 * POST /api/agent/object-exports/[jobId]/complete — BCAgent worker reports the
 * outcome after restoring the customer's licence.
 *   { ok: true,  chunkCount, restoreVerified, finsqlLog? }  → processing starts in the background
 *   { ok: false, error, finsqlLog?, restoreVerified? }      → job failed (shown with Retry)
 */

import { NextRequest, NextResponse, after } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateJob } from '@/lib/agent-job-auth'
import { processExportJob } from '@/lib/corpus/process-export'
import { MAX_CHUNKS } from '@/lib/corpus/export-jobs'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.slice(0, n) : null)

export async function POST(req: NextRequest, props: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await props.params
  const job = await authenticateJob(req, jobId)
  if (job instanceof NextResponse) return job
  if (job.status !== 'running') return NextResponse.json({ error: 'Job is ' + job.status + ', not running.' }, { status: 409 })

  const body = await req.json().catch(() => ({})) as any
  const restoreVerified = typeof body.restoreVerified === 'boolean' ? body.restoreVerified : null
  const restoreNote = restoreVerified === false
    ? ' WARNING: BCAgent could not verify the customer\'s licence was restored — check the database licence now.'
    : ''

  if (!body.ok) {
    await (prisma as any).objectExportJob.update({
      where: { id: jobId },
      data: {
        status: 'failed', finishedAt: new Date(), restoreVerified,
        error: (clip(body.error, 2000) ?? 'Export failed on the server.') + restoreNote,
        finsqlLog: clip(body.finsqlLog, 20000),
      },
    })
    return NextResponse.json({ ok: true })
  }

  const chunkCount = parseInt(String(body.chunkCount), 10)
  if (!Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > MAX_CHUNKS) {
    return NextResponse.json({ error: 'Invalid chunkCount' }, { status: 400 })
  }

  await (prisma as any).objectExportJob.update({
    where: { id: jobId },
    data: {
      status: 'uploaded', chunkCount, restoreVerified,
      finsqlLog: clip(body.finsqlLog, 20000),
      error: restoreNote ? restoreNote.trim() : null,
    },
  })
  after(() => processExportJob(jobId))
  return NextResponse.json({ ok: true })
}
