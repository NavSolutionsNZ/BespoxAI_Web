/**
 * POST /api/requirements/[id]/objects/deploy-prod
 *
 * Superadmin only. Triggers BCAgent to import + compile a written snapshot
 * into the PRODUCTION environment. On success, sets prodDeployedAt +
 * prodDeploySnapshotId and notifies the customer that their changes are live.
 *
 * Gates: prodApprovedAt must be set (customer approved go-live doc).
 *
 * Body: { snapshotId: string }
 *
 * maxDuration: 60s (Hobby). Bump to 300 on Vercel Pro for large object sets.
 */

import { NextRequest, NextResponse }  from 'next/server'
import { getServerSession }           from 'next-auth'
import { authOptions }                from '@/lib/auth'
import { prisma }                     from '@/lib/db'
import { notifyCustomerProdDeployed } from '@/lib/notifications'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const requirement = await (prisma as any).requirement.findUnique({
    where:  { id: params.id },
    select: {
      id: true, title: true, tenantId: true, status: true,
      prodApprovedAt: true, prodDeployedAt: true,
      tenant: { select: { name: true, tunnelSubdomain: true, apiKey: true } },
      user:   { select: { name: true, email: true } },
    },
  })

  if (!requirement)
    return NextResponse.json({ error: 'Requirement not found' }, { status: 404 })

  if (!requirement.prodApprovedAt)
    return NextResponse.json({ error: 'Customer must approve go-live document before deploying to production' }, { status: 400 })

  const { snapshotId } = await req.json().catch(() => ({})) as { snapshotId?: string }
  if (!snapshotId)
    return NextResponse.json({ error: 'snapshotId required' }, { status: 400 })

  // ── DEBUG — simulate successful production deployment ─────────────────────
  if (process.env.SETTINGS_DEBUG === 'true') {
    const mockResults = [
      { filename: 'Codeunit_80_Sales-Post.txt',            imported: true, compiled: true, error: '' },
      { filename: 'Table_50100_Custom_Approval_Entry.txt', imported: true, compiled: true, error: '' },
    ]
    const now = new Date()
    await (prisma as any).requirement.update({
      where: { id: params.id },
      data:  { prodDeployedAt: now, prodDeploySnapshotId: snapshotId },
    })
    notifyCustomerProdDeployed({
      tenantId:      requirement.tenantId,
      customerEmail: requirement.user.email,
      customerName:  requirement.user.name ?? '',
      title:         requirement.title,
      tenantName:    requirement.tenant?.name ?? '',
    }).catch(() => {})
    return NextResponse.json({ success: true, results: mockResults, snapshotId, deployedAt: now.toISOString(), _debug: true })
  }
  // ── END DEBUG ─────────────────────────────────────────────────────────────

  const tenant = requirement.tenant
  if (!tenant?.tunnelSubdomain)
    return NextResponse.json({ error: 'Tenant tunnel not configured' }, { status: 400 })

  const agentBase = 'https://' + tenant.tunnelSubdomain + '-agent.bespoxai.com'

  let agentRes: Response
  try {
    agentRes = await fetch(agentBase + '/bespoxai/objects/deploy', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-BespoxAI-Key': tenant.apiKey },
      body:    JSON.stringify({
        requirementId: params.id,
        snapshotId,
        environment: 'production',
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
    const now = new Date()
    await (prisma as any).requirement.update({
      where: { id: params.id },
      data:  {
        prodDeployedAt:       now,
        prodDeploySnapshotId: snapshotId,
      },
    })

    // Notify customer — changes are live
    notifyCustomerProdDeployed({
      tenantId:      requirement.tenantId,
      customerEmail: requirement.user.email,
      customerName:  requirement.user.name ?? '',
      title:         requirement.title,
      tenantName:    requirement.tenant?.name ?? '',
    }).catch(e => console.error('[deploy-prod] notify customer:', e))
  }

  return NextResponse.json({
    success:    data.success,
    results:    data.results,
    snapshotId,
    deployedAt: data.success ? new Date().toISOString() : null,
  })
}
