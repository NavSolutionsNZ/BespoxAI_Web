/**
 * lib/export-job-routes.ts
 *
 * Shared handlers for scheduling and listing BCAgent full object exports
 * (design §14). The admin and partner routes do their own auth, then call
 * these with the tenant id and the acting user.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getLicenceMeta, licenceOwnerForTenant, licenceProblem } from '@/lib/licences'
import {
  ACTIVE_STATUSES, OUT_OF_HOURS_END, OUT_OF_HOURS_START,
  isOutOfHours, isStale, newJobToken, tenantTimeZone,
} from '@/lib/corpus/export-jobs'

const db = prisma as any
// Where BCAgent sends its callbacks. The agent only accepts *.bespoxai.com, so this
// is pinned rather than taken from NEXTAUTH_URL (API routes don't depend on the host).
const AGENT_CALLBACK_BASE = process.env.AGENT_CALLBACK_BASE ?? 'https://bespoxai.com'
const MAX_AHEAD_MS = 14 * 24 * 60 * 60 * 1000

const JOB_FIELDS = {
  id: true, status: true, notBefore: true, outOfHours: true, requestedById: true, licenceOwnerId: true,
  licenceFetchedAt: true, startedAt: true, finishedAt: true, error: true, finsqlLog: true, restoreVerified: true,
  matchConfidence: true, summary: true, repoOwner: true, repoName: true, exportCommit: true,
  createdAt: true, updatedAt: true,
}

async function loadTenant(tenantId: string) {
  return db.tenant.findFirst({
    where:  { id: tenantId },
    select: {
      id: true, name: true, active: true, tunnelSubdomain: true, apiKey: true, navDatabaseName: true,
      partnerAccountId: true, country: true, timeZone: true,
    },
  })
}

/** Mark jobs that stopped progressing as stale, then return the recent history. */
export async function listExports(tenantId: string) {
  const tenant = await loadTenant(tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const now = new Date()
  const active = await db.objectExportJob.findMany({
    where:  { tenantId, status: { in: ACTIVE_STATUSES } },
    select: { id: true, status: true, notBefore: true, licenceFetchedAt: true, updatedAt: true },
  })
  const staleIds = active.filter((j: any) => isStale(j, now)).map((j: any) => j.id)
  if (staleIds.length) {
    await db.objectExportJob.updateMany({
      where: { id: { in: staleIds } },
      data:  { status: 'stale', error: 'No progress from BCAgent within the expected time. Check the agent is running, then retry.' },
    })
  }

  const jobs = await db.objectExportJob.findMany({
    where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 20, select: JOB_FIELDS,
  })
  const ownerId = licenceOwnerForTenant(tenant)
  const meta = await getLicenceMeta(ownerId)
  return NextResponse.json({
    jobs,
    licence: { owner: ownerId ? 'partner' : 'nav_solutions', problem: licenceProblem(meta), fileName: meta?.fileName ?? null },
    timeZone: tenantTimeZone(tenant),
    outOfHours: { startHour: OUT_OF_HOURS_START, endHour: OUT_OF_HOURS_END },
    ready: !!tenant.tunnelSubdomain && !!tenant.navDatabaseName,
  })
}

export async function scheduleExport(args: {
  tenantId: string
  userId: string
  notBefore: string | undefined
  confirmInHours: boolean
}) {
  const tenant = await loadTenant(args.tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  if (!tenant.active) return NextResponse.json({ error: 'Tenant is inactive.' }, { status: 400 })
  if (!tenant.tunnelSubdomain) return NextResponse.json({ error: 'BCAgent tunnel is not configured for this tenant.' }, { status: 400 })
  if (!tenant.navDatabaseName) return NextResponse.json({ error: 'NAV database name is not set. Add it in the BC Installer tab.' }, { status: 400 })

  const ownerId = licenceOwnerForTenant(tenant)
  const problem = licenceProblem(await getLicenceMeta(ownerId))
  if (problem) {
    return NextResponse.json({
      error: problem + (ownerId ? ' Upload it under Partner settings → Developer licence.' : ' Upload Nav Solutions\' licence in Admin → Developer licence.'),
    }, { status: 400 })
  }

  const now = new Date()
  const notBefore = args.notBefore ? new Date(args.notBefore) : null
  if (!notBefore || isNaN(notBefore.getTime())) return NextResponse.json({ error: 'Choose a start time.' }, { status: 400 })
  if (notBefore.getTime() < now.getTime() - 5 * 60 * 1000) return NextResponse.json({ error: 'Start time is in the past.' }, { status: 400 })
  if (notBefore.getTime() > now.getTime() + MAX_AHEAD_MS) return NextResponse.json({ error: 'Start time must be within 14 days.' }, { status: 400 })

  const tz = tenantTimeZone(tenant)
  const outOfHours = isOutOfHours(notBefore, tz)
  if (!outOfHours && !args.confirmInHours) {
    return NextResponse.json({
      needsConfirm: true,
      error: 'That start time is inside business hours for this customer (' + tz + '). The export briefly swaps the database licence and loads the SQL server — confirm to schedule anyway.',
    }, { status: 409 })
  }

  const existing = await db.objectExportJob.findMany({
    where:  { tenantId: tenant.id, status: { in: ACTIVE_STATUSES } },
    select: { id: true, status: true, notBefore: true, licenceFetchedAt: true, updatedAt: true },
  })
  if (existing.some((j: any) => !isStale(j, now))) {
    return NextResponse.json({ error: 'An export is already scheduled or running for this customer.' }, { status: 409 })
  }

  const { token, hash } = newJobToken()
  const job = await db.objectExportJob.create({
    data: {
      tenantId: tenant.id, requestedById: args.userId, licenceOwnerId: ownerId,
      notBefore, outOfHours, status: 'scheduled', jobTokenHash: hash,
    },
    select: JOB_FIELDS,
  })

  const agentBase = 'https://' + tenant.tunnelSubdomain + '-agent.bespoxai.com'
  let failure: string | null = null
  try {
    const res = await fetch(agentBase + '/bespoxai/objects/full-export', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-BespoxAI-Key': tenant.apiKey },
      body:    JSON.stringify({ jobId: job.id, notBefore: notBefore.toISOString(), portalBase: AGENT_CALLBACK_BASE, jobToken: token }),
      signal:  AbortSignal.timeout(30_000),
    })
    if (res.status === 404) failure = 'This BCAgent version does not support full exports — download and re-run the latest installer.'
    else if (!res.ok) {
      let msg = 'BCAgent returned ' + res.status
      try { const e = await res.json(); msg = e.error ?? msg } catch {}
      failure = msg
    }
  } catch (e: any) {
    failure = 'Could not reach BCAgent: ' + (e?.message ?? 'network error')
  }

  if (failure) {
    await db.objectExportJob.update({ where: { id: job.id }, data: { status: 'failed', error: failure, finishedAt: new Date() } })
    return NextResponse.json({ error: failure }, { status: 502 })
  }
  return NextResponse.json({ job }, { status: 201 })
}
