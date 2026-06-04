/**
 * POST /api/requirements/[id]/manual-deploy-prod
 *
 * Superadmin only. Records a manual deployment to production —
 * skips BCAgent and write-files entirely. Sets prodDeployedAt,
 * appends a deployment note, and notifies the customer that
 * their changes are live. Gate: prodApprovedAt must be set.
 */

import { NextRequest, NextResponse }  from 'next/server'
import { getServerSession }           from 'next-auth'
import { authOptions }                from '@/lib/auth'
import { prisma }                     from '@/lib/db'
import { notifyCustomerProdDeployed } from '@/lib/notifications'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const user = session.user as any
  const name = (user.preferredName ?? user.firstName ?? user.name ?? 'Admin') as string

  const requirement = await (prisma as any).requirement.findUnique({
    where:  { id: params.id },
    select: {
      id: true, title: true, tenantId: true,
      prodApprovedAt:  true,
      deploymentNotes: true,
      tenant: { select: { name: true } },
      user:   { select: { name: true, email: true } },
    },
  })
  if (!requirement)
    return NextResponse.json({ error: 'Requirement not found' }, { status: 404 })

  if (!requirement.prodApprovedAt)
    return NextResponse.json(
      { error: 'Customer must approve go-live document before recording production deployment' },
      { status: 400 }
    )

  const now      = new Date()
  const dateStr  = now.toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' })
  const newNote  = 'Manually deployed to production by ' + name + ' on ' + dateStr
  const existing = requirement.deploymentNotes ? requirement.deploymentNotes + '\n' : ''

  await (prisma as any).requirement.update({
    where: { id: params.id },
    data:  {
      prodDeployedAt:      now,
      prodDeploySnapshotId: null,
      deploymentNotes:     existing + newNote,
    },
  })

  notifyCustomerProdDeployed({
    tenantId:      requirement.tenantId,
    customerEmail: requirement.user.email,
    customerName:  requirement.user.name ?? '',
    title:         requirement.title,
    tenantName:    requirement.tenant?.name ?? '',
  }).catch(e => console.error('[manual-deploy-prod] notify customer:', e))

  return NextResponse.json({ success: true, deployedAt: now.toISOString() })
}
