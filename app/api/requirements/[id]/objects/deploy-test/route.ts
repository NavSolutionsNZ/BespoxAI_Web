/**
 * POST /api/requirements/[id]/objects/deploy-test
 *
 * Superadmin only. Triggers BCAgent to import + compile a written snapshot
 * into the test environment. On success, sets testDeployedAt + testDeploySnapshotId
 * and clears any previous UAT approval (new deployment resets the UAT cycle).
 *
 * Body: { snapshotId: string }
 *
 * maxDuration: 60s (Hobby). Bump to 300 on Vercel Pro for large object sets.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { prisma }                    from '@/lib/db'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60  // bump to 300 on Vercel Pro

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const requirement = await (prisma as any).requirement.findUnique({
    where:  { id: params.id },
    select: { id: true, tenantId: true, status: true },
  })
  if (!requirement)
    return NextResponse.json({ error: 'Requirement not found' }, { status: 404 })

  const { snapshotId } = await req.json().catch(() => ({})) as { snapshotId?: string }
  if (!snapshotId)
    return NextResponse.json({ error: 'snapshotId required' }, { status: 400 })

  const tenant = await (prisma as any).tenant.findUnique({
    where:  { id: requirement.tenantId },
    select: { tunnelSubdomain: true, apiKey: true, testNavDatabaseName: true },
  })
  if (!tenant?.tunnelSubdomain)
    return NextResponse.json({ error: 'Tenant tunnel not configured' }, { status: 400 })

  if (!tenant.testNavDatabaseName)
    return NextResponse.json({
      error: 'Test NAV database not configured. Add it in the BC Installer tab.',
    }, { status: 400 })

  const agentBase = `https://${tenant.tunnelSubdomain}-agent.bespoxai.com`

  const agentRes = await fetch(`${agentBase}/bespoxai/objects/deploy`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-BespoxAI-Key': tenant.apiKey },
    body:    JSON.stringify({
      requirementId: params.id,
      snapshotId,
      environment: 'test',
    }),
  })

  if (!agentRes.ok) {
    let msg = `BCAgent returned ${agentRes.status}`
    try { const e = await agentRes.json(); msg = e.error ?? msg } catch {}
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  const data = await agentRes.json()

  if (data.success) {
    // Update requirement — set testDeployedAt, clear any previous UAT state
    await (prisma as any).requirement.update({
      where: { id: params.id },
      data:  {
        testDeployedAt:       new Date(),
        testDeploySnapshotId: snapshotId,
        // Clear previous UAT cycle on new deployment
        uatApprovedAt:        null,
        uatApprovedById:      null,
        uatRejectedAt:        null,
        uatRejectedById:      null,
        uatRejectionReason:   null,
        uatRejectionAnalysis: null,
      },
    })
  }

  return NextResponse.json({
    success:    data.success,
    results:    data.results,
    snapshotId,
    deployedAt: data.success ? new Date().toISOString() : null,
  })
}
