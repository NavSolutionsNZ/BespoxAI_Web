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

import { isBespoxTunnelUrl, TEST_DEPLOY_STATUSES } from '@/lib/tenants'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { prisma }                    from '@/lib/db'
import { notifyCustomerReadyForUAT } from '@/lib/notifications'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60  // bump to 300 on Vercel Pro

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const requirement = await (prisma as any).requirement.findUnique({
    where:  { id: params.id },
    select: { id: true, tenantId: true, status: true },
  })
  if (!requirement)
    return NextResponse.json({ error: 'Requirement not found' }, { status: 404 })
  if (!TEST_DEPLOY_STATUSES.includes(requirement.status))
    return NextResponse.json({ error: 'Deploy to test is only possible once the deposit is paid and before UAT sign-off (current status: ' + requirement.status + ').' }, { status: 400 })

  const { snapshotId } = await req.json().catch(() => ({})) as { snapshotId?: string }
  if (!snapshotId)
    return NextResponse.json({ error: 'snapshotId required' }, { status: 400 })

  const tenant = await (prisma as any).tenant.findUnique({
    where:  { id: requirement.tenantId },
    select: { tunnelSubdomain: true, apiKey: true, testNavDatabaseName: true, testServerSeparate: true, testAgentUrl: true },
  })
  if (!tenant?.tunnelSubdomain)
    return NextResponse.json({ error: 'Tenant tunnel not configured' }, { status: 400 })

  if (!tenant.testNavDatabaseName)
    return NextResponse.json({
      error: 'Test NAV database not configured. Add it in the BC Installer tab.',
    }, { status: 400 })

  // Use separate test agent URL if configured, otherwise use production agent
  if (tenant.testServerSeparate && tenant.testAgentUrl && !isBespoxTunnelUrl(tenant.testAgentUrl))
    return NextResponse.json({ error: 'The test agent URL is not a BespoxAI tunnel address — update it in Settings.' }, { status: 400 })

  const agentBase = (tenant.testServerSeparate && tenant.testAgentUrl)
    ? tenant.testAgentUrl.replace(/\/$/, '')
    : 'https://' + tenant.tunnelSubdomain + '-agent.bespoxai.com'

  let agentRes: Response
  try {
    agentRes = await fetch(agentBase + '/bespoxai/objects/deploy', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-BespoxAI-Key': tenant.apiKey },
      body:    JSON.stringify({
        requirementId: params.id,
        snapshotId,
        environment: 'test',
      }),
    })
  } catch (e: any) {
    return NextResponse.json({ error: 'Could not reach BCAgent: ' + (e.message ?? 'network error') }, { status: 502 })
  }

  if (!agentRes.ok) {
    let msg = 'BCAgent returned ' + agentRes.status
    try { const e = await agentRes.json(); msg = e.error ?? msg } catch {}
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  // Read as text first — BCAgent may return malformed JSON (e.g. unescaped paths)
  const rawText = await agentRes.text()
  let data: any = {}
  try { data = JSON.parse(rawText) } catch { /* malformed JSON from agent — continue with partial data */ }

  if (data.success) {
    // Update requirement — set testDeployedAt, clear any previous UAT state
    const reqForNotify = await (prisma as any).requirement.findUnique({
      where:  { id: params.id },
      select: { title: true, user: { select: { name: true, email: true } }, tenant: { select: { name: true } } },
    })
    await (prisma as any).requirement.update({
      where: { id: params.id },
      data:  {
        status:               'in_uat',
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
    if (reqForNotify) {
      notifyCustomerReadyForUAT({
        tenantId:      requirement.tenantId,
        customerEmail: reqForNotify.user.email,
        customerName:  reqForNotify.user.name ?? '',
        title:         reqForNotify.title,
        tenantName:    reqForNotify.tenant?.name ?? '',
      }).catch(e => console.error('[deploy-test] notify UAT:', e))
    }
  }

  return NextResponse.json({
    success:    data.success,
    results:    data.results,
    snapshotId,
    deployedAt: data.success ? new Date().toISOString() : null,
  })
}
