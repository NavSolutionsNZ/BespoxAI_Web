/**
 * PUT /api/agent/object-exports/[jobId]/chunks?seq=N — one ≤4 MB chunk of the
 * gzipped raw finsql export (stays under Vercel's request body limit).
 * Chunks are held only until processing finishes. Re-sending a seq replaces it.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateJob } from '@/lib/agent-job-auth'
import { MAX_CHUNK_BYTES, MAX_CHUNKS } from '@/lib/corpus/export-jobs'

export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest, props: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await props.params
  const job = await authenticateJob(req, jobId)
  if (job instanceof NextResponse) return job
  if (job.status !== 'running') return NextResponse.json({ error: 'Job is ' + job.status + ', not running.' }, { status: 409 })

  const seq = parseInt(req.nextUrl.searchParams.get('seq') ?? '', 10)
  if (!Number.isInteger(seq) || seq < 0 || seq >= MAX_CHUNKS) return NextResponse.json({ error: 'Invalid seq' }, { status: 400 })

  const data = Buffer.from(await req.arrayBuffer())
  if (data.length === 0) return NextResponse.json({ error: 'Empty chunk' }, { status: 400 })
  if (data.length > MAX_CHUNK_BYTES) return NextResponse.json({ error: 'Chunk larger than 4 MB' }, { status: 413 })

  await (prisma as any).objectExportChunk.upsert({
    where:  { jobId_seq: { jobId, seq } },
    create: { jobId, seq, data },
    update: { data },
  })
  await (prisma as any).objectExportJob.update({ where: { id: jobId }, data: { updatedAt: new Date() } })
  return NextResponse.json({ ok: true, seq, bytes: data.length })
}
