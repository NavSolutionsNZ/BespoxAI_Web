/**
 * POST /api/partner/tenants/[id]/requirements/[reqId]/objects/deploy-test
 *
 * Partner-deliverer equivalent of the direct
 * /api/requirements/[id]/objects/deploy-test.
 *
 * Triggers the CLIENT tenant's BCAgent to import + compile a written snapshot
 * into the test environment. On success sets status:'in_uat' + testDeployedAt +
 * testDeploySnapshotId, clears any previous UAT cycle, and notifies the client
 * customer (white-label from-address via getPartnerFromEmail in the helper).
 *
 * Auth: partner session + tenant ownership + can-develop + deploy gate
 * (partner_admin OR assigned developer).
 *
 * Body: { snapshotId: string }
 *
 * maxDuration: 60s (Hobby). Bump to 300 on Vercel Pro for large object sets.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  requirePartnerSession,
  assertTenantBelongsToPartner,
  assertPartnerCanDevelop,
  partnerCanDeploy,
} from '@/lib/partner-auth'
import { prisma } from '@/lib/db'
import { notifyCustomerReadyForUAT } from '@/lib/notifications'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; reqId: string } }
) {
  const session = await requirePartnerSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await assertTenantBelongsToPartner(params.id, session.partnerAccountId)
  } catch {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  try {
    await assertPartnerCanDevelop(session.partnerAccountId)
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Forbidden' }, { status: 403 })
  }

  const requirement = await (prisma as any).requirement.findFirst({
    where:  { id: params.reqId, tenantId: params.id },
    select: { id: true, tenantId: true, status: true, assignedDeveloperId: true },
  })
  if (!requirement)
    return NextResponse.json({ error: 'Requirement not found' }, { status: 404 })

  if (!partnerCanDeploy(session, requirement.assignedDeveloperId))
    return NextResponse.json({ error: 'Only the assigned developer or a partner admin can deploy.' }, { status: 403 })

  const { snapshotId } = await req.json().catch(() => ({})) as { snapshotId?: string }
  if (!snapshotId)
    return NextResponse.json({ error: 'snapshotId required' }, { status: 400 })

  // ── DEBUG — simulate successful test deployment, write real DB fields ──────
  if (process.env.SETTINGS_DEBUG === 'true') {
    const mockResults = [
      { filename: 'Codeunit_80_Sales-Post.txt',            imported: true, compiled: true,  error: '' },
      { filename: 'Table_50100_Custom_Approval_Entry.txt', imported: true, compiled: true,  error: '' },
      { filename: 'Page_50300_Custom_Approval_List.txt',   imported: true, compiled: false,
        error: 'NAV compilation skipped in debug mode' },
    ]
    const now = new Date()
    const reqForNotify = await (prisma as any).requirement.findFirst({
      where:  { id: params.reqId, tenantId: params.id },
      select: { title: true, user: { select: { name: true, email: true } }, tenant: { select: { name: true } } },
    })
    await (prisma as any).requirement.update({
      where: { id: params.reqId },
      data:  {
        status:               'in_uat',
        testDeployedAt:       now,
        testDeploySnapshotId: snapshotId,
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
      }).catch(e => console.error('[partner deploy-test] notify UAT:', e))
    }
    return NextResponse.json({
      success:    true,
      results:    mockResults,
      snapshotId,
      deployedAt: now.toISOString(),
      _debug:     true,
    })
  }
  // ── END DEBUG ─────────────────────────────────────────────────────────────

  const tenant = await (prisma as any).tenant.findFirst({
    where:  { id: requirement.tenantId },
    select: { tunnelSubdomain: true, apiKey: true, testNavDatabaseName: true, testServerSeparate: true, testAgentUrl: true },
  })
  if (!tenant?.tunnelSubdomain)
    return NextResponse.json({ error: 'Tenant tunnel not configured' }, { status: 400 })

  if (!tenant.testNavDatabaseName)
    return NextResponse.json({
      error: 'Test NAV database not configured for this client tenant.',
    }, { status: 400 })

  const agentBase = (tenant.testServerSeparate && tenant.testAgentUrl)
    ? tenant.testAgentUrl.replace(/\/$/, '')
    : 'https://' + tenant.tunnelSubdomain + '-agent.bespoxai.com'

  let agentRes: Response
  try {
    agentRes = await fetch(agentBase + '/bespoxai/objects/deploy', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-BespoxAI-Key': tenant.apiKey },
      body:    JSON.stringify({
        requirementId: params.reqId,
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

  const rawText = await agentRes.text()
  let data: any = {}
  try { data = JSON.parse(rawText) } catch { /* malformed JSON from agent */ }

  if (data.success) {
    const reqForNotify = await (prisma as any).requirement.findFirst({
      where:  { id: params.reqId, tenantId: params.id },
      select: { title: true, user: { select: { name: true, email: true } }, tenant: { select: { name: true } } },
    })
    await (prisma as any).requirement.update({
      where: { id: params.reqId },
      data:  {
        status:               'in_uat',
        testDeployedAt:       new Date(),
        testDeploySnapshotId: snapshotId,
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
      }).catch(e => console.error('[partner deploy-test] notify UAT:', e))
    }
  }

  return NextResponse.json({
    success:    data.success,
    results:    data.results,
    snapshotId,
    deployedAt: data.success ? new Date().toISOString() : null,
  })
}
