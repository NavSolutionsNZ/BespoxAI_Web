/**
 * POST /api/partner/tenants/[id]/requirements/[reqId]/uat-approve
 *
 * Partner signs off UAT on behalf of the tenant. Mirrors the direct
 * uat-approve route; notifies the partner team of the outcome.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerSession, assertTenantBelongsToPartner } from '@/lib/partner-auth'
import { prisma }                    from '@/lib/db'
import { notifyPartnerUatApproved }  from '@/lib/notifications'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; reqId: string } }
) {
  const session = await requirePartnerSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await assertTenantBelongsToPartner(params.id, session.partnerAccountId)
  } catch {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const requirement = await (prisma as any).requirement.findFirst({
    where:  { id: params.reqId, tenantId: params.id },
    select: {
      id: true, title: true, tenantId: true,
      status: true, testDeployedAt: true, uatApprovedAt: true,
      tenant: { select: { name: true } },
      user:   { select: { name: true, email: true } },
    },
  })

  if (!requirement)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!requirement.testDeployedAt)
    return NextResponse.json({ error: 'No test deployment recorded' }, { status: 400 })
  if (requirement.uatApprovedAt)
    return NextResponse.json({ error: 'UAT already approved' }, { status: 400 })

  const now = new Date()

  await (prisma as any).requirement.update({
    where: { id: params.reqId },
    data:  {
      status:               'uat_confirmed',
      uatApprovedAt:        now,
      uatApprovedById:      session.userId,
      uatRejectedAt:        null,
      uatRejectedById:      null,
      uatRejectionReason:   null,
      uatRejectionAnalysis: null,
    },
  })

  const customerName = requirement.user?.name ?? requirement.user?.email ?? 'Customer'
  const tenantName   = requirement.tenant?.name ?? 'Unknown tenant'

  notifyPartnerUatApproved({
    tenantId:   params.id,
    title:      requirement.title,
    tenantName,
    customerName,
  }).catch(() => {/* non-fatal */})

  return NextResponse.json({ approved: true, approvedAt: now.toISOString() })
}
