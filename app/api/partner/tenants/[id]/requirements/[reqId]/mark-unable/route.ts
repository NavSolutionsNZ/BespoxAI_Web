import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerSession, assertTenantBelongsToPartner } from '@/lib/partner-auth'
import { prisma } from '@/lib/db'
import { notifyPartnerRequirementUnableToComplete } from '@/lib/notifications'

export const dynamic = 'force-dynamic'

// POST /api/partner/tenants/[id]/requirements/[reqId]/mark-unable
// Partner-deliverer equivalent of the direct mark-unable. Any partner team member
// (partner_admin or partner_developer) of this account can flag it; partner_admins
// are notified. BespoxAI is NOT in the partner loop.
export async function POST(_req: NextRequest, { params }: { params: { id: string; reqId: string } }) {
  const session = await requirePartnerSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await assertTenantBelongsToPartner(params.id, session.partnerAccountId)
  } catch {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  // Scope the requirement to this tenant (findFirst — reqId+tenantId is not @unique)
  const requirement = await (prisma as any).requirement.findFirst({
    where:  { id: params.reqId, tenantId: params.id },
    include: {
      assignedDeveloper: { select: { firstName: true, preferredName: true, name: true } },
    },
  })
  if (!requirement) return NextResponse.json({ error: 'Requirement not found' }, { status: 404 })

  const updated = await (prisma as any).requirement.update({
    where: { id: requirement.id },
    data:  { unableToCompleteAt: new Date() },
    include: {
      user:   { select: { name: true, email: true } },
      tenant: { select: { name: true, country: true, paymentTermsKey: true } },
      assignedDeveloper: { select: { id: true, name: true, email: true, firstName: true, preferredName: true } },
      addenda: {
        orderBy: { createdAt: 'asc' as const },
        select:  { id: true, title: true, status: true, quote: true, createdAt: true, parentId: true },
      },
    },
  })

  const devName = requirement.assignedDeveloper?.preferredName
    ?? requirement.assignedDeveloper?.firstName
    ?? requirement.assignedDeveloper?.name
    ?? 'A developer'

  notifyPartnerRequirementUnableToComplete({
    tenantId:         params.id,
    requirementId:    requirement.id,
    requirementTitle: requirement.title,
    tenantName:       updated.tenant?.name ?? '',
    devName,
  })

  return NextResponse.json({ requirement: updated }, { status: 200 })
}
