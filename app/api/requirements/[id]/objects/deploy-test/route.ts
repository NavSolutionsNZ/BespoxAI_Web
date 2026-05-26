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
import { notifyCustomerReadyForUAT } from '@/lib/notifications'

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

  // ── DEBUG — simulate successful test deployment, write real DB fields ──────
  if (process.env.SETTINGS_DEBUG === 'true') {
    const mockResults = [
      { filename: 'Codeunit_80_Sales-Post.txt',            imported: true, compiled: true,  error: '' },
      { filename: 'Table_50100_Custom_Approval_Entry.txt', imported: true, compiled: true,  error: '' },
      { filename: 'Page_50300_Custom_Approval_List.txt',   imported: true, compiled: false,
        error: 'NAV compilation skipped in debug mode' },
    ]
    const now = new Date()
    const reqForNotify = await (prisma as any).requirement.findUnique({
      where:  { id: params.id },
      select: { title: true, user: { select: { name: true, email: true } }, tenant: { select: { name: true } } },
    })
    await (prisma as any).requirement.update({
      where: { id: params.id },
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
        customerEmail: reqForNotify.user.email,
        customerName:  reqForNotify.user.name ?? '',
        title:         reqForNotify.title,
        tenantName:    reqForNotify.tenant?.name ?? '',
      }).catch(e => console.error('[deploy-test] notify UAT:', e))
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
