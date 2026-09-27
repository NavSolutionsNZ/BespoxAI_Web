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
import { requireSuperadmin } from '@/lib/api-auth'
import { prisma }                     from '@/lib/db'
import { notifyCustomerProdDeployed } from '@/lib/notifications'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await requireSuperadmin()
  if (session instanceof NextResponse) return session

  const requirement = await (prisma as any).requirement.findUnique({
    where:  { id: params.id },
    select: {
      id: true, title: true, tenantId: true, status: true,
      prodApprovedAt: true, prodDeployedAt: true, testDeploySnapshotId: true,
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
  // Production gets exactly what the customer tested and signed off
  if (snapshotId !== requirement.testDeploySnapshotId)
    return NextResponse.json({ error: 'Only the snapshot deployed to test and approved in UAT can go to production.' }, { status: 400 })

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
