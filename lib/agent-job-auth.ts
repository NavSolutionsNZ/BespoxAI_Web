/**
 * lib/agent-job-auth.ts — authenticate BCAgent's callbacks for one export job.
 * The agent holds a random per-job token (sent once when the job was scheduled);
 * only its SHA-256 is stored. No session, no tenant API key on these routes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { jobTokenMatches } from '@/lib/corpus/export-jobs'

export const JOB_TOKEN_HEADER = 'x-bespoxai-job-token'

export async function authenticateJob(req: NextRequest, jobId: string): Promise<any | NextResponse> {
  const job = await (prisma as any).objectExportJob.findFirst({ where: { id: jobId } })
  if (!job || !jobTokenMatches(req.headers.get(JOB_TOKEN_HEADER), job.jobTokenHash)) {
    return NextResponse.json({ error: 'Unknown job or invalid token' }, { status: 401 })
  }
  return job
}
