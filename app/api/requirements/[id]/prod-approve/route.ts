/**
 * POST /api/requirements/[id]/prod-approve
 *
 * Tenant admin only. Customer reviews the go-live document and approves
 * production deployment. Records approval and notifies superadmins.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { prisma }                    from '@/lib/db'
import { notifyAdminsProdApproved }  from '@/lib/notifications'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  const role    = (session?.user as any)?.role
  if (!session?.user || !['tenant_admin', 'superadmin'].includes(role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const userId = (session.user as any).id

  const requirement = await (prisma as any).requirement.findUnique({
    where:  { id: params.id },
    select: {
      id: true, title: true, tenantId: true,
      prodApprovalSentAt: true, prodApprovedAt: true,
      tenant: { select: { name: true } },
      user:   { select: { name: true, email: true } },
    },
  })

  if (!requirement)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!requirement.prodApprovalSentAt)
    return NextResponse.json({ error: 'No go-live document has been sent yet' }, { status: 400 })

  if (requirement.prodApprovedAt)
    return NextResponse.json({ error: 'Go-live already approved' }, { status: 400 })

  const now = new Date()

  await (prisma as any).requirement.update({
    where: { id: params.id },
    data:  {
      prodApprovedAt:   now,
      prodApprovedById: userId,
    },
  })

  // Notify superadmins — customer is ready for prod deploy
  notifyAdminsProdApproved({
    title:        requirement.title,
    tenantName:   requirement.tenant?.name ?? '',
    customerName: requirement.user?.name ?? requirement.user?.email ?? 'Customer',
  }).catch(e => console.error('[prod-approve] notify:', e))

  return NextResponse.json({ approved: true, approvedAt: now.toISOString() })
}
