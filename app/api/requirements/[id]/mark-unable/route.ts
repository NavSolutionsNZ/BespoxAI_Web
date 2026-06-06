import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { notifyAdminRequirementUnableToComplete } from '@/lib/notifications'

export const dynamic = 'force-dynamic'

// POST /api/requirements/[id]/mark-unable
// Developer marks requirement as unable to complete, notifies admin
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = session.user as any

  try {
    // Get requirement
    const requirement = await prisma.requirement.findUnique({
      where: { id: params.id },
      include: {
        tenant: { select: { id: true, name: true } },
        assignedDeveloper: { select: { id: true, firstName: true, preferredName: true, email: true } },
      },
    })

    if (!requirement) {
      return NextResponse.json({ error: 'Requirement not found' }, { status: 404 })
    }

    // Only assigned dev or admin can mark as unable
    const isAssignedDev = requirement.assignedDeveloperId === user.id
    const isAdmin = user.role === 'superadmin' || (user.role === 'tenant_admin' && user.tenantId === requirement.tenantId)
    const isPartnerAdmin = user.role === 'partner_admin'

    if (!isAssignedDev && !isAdmin && !isPartnerAdmin) {
      return NextResponse.json(
        { error: 'Only assigned developer or admin can mark as unable' },
        { status: 403 }
      )
    }

    // Update requirement
    const updated = await prisma.requirement.update({
      where: { id: params.id },
      data: {
        unableToCompleteAt: new Date(),
      },
      include: {
        tenant: { select: { name: true } },
        user: { select: { email: true } },
        assignedDeveloper: { select: { firstName: true, preferredName: true } },
      },
    })

    // Find admin(s) to notify
    const admins = await prisma.user.findMany({
      where: {
        tenantId: requirement.tenantId,
        role: 'tenant_admin',
      },
      select: { email: true },
    })

    // Also notify superadmins if this is a direct tenant (not partner-managed)
    let superadmins: any[] = []
    if (!requirement.tenant) {
      superadmins = await prisma.user.findMany({
        where: { role: 'superadmin' },
        select: { email: true },
      })
    }

    const allAdmins = [...admins, ...superadmins]

    // Notify each admin
    const devName = requirement.assignedDeveloper?.preferredName ?? requirement.assignedDeveloper?.firstName ?? 'Developer'
    for (const admin of allAdmins) {
      await notifyAdminRequirementUnableToComplete({
        to: admin.email,
        devName,
        requirementTitle: requirement.title,
        tenantName: updated.tenant?.name ?? '',
        requirementId: requirement.id,
      })
    }

    return NextResponse.json({ requirement: updated }, { status: 200 })
  } catch (err: any) {
    console.error('[mark unable]', err?.message)
    return NextResponse.json({ error: 'Database error', details: err?.message }, { status: 500 })
  }
}
