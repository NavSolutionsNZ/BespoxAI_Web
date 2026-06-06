import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { notifyRequirementAssigned, getPartnerFromEmail } from '@/lib/notifications'

export const dynamic = 'force-dynamic'

// PATCH /api/requirements/[id]/assign
// Admin assigns requirement to a developer (or reassigns from one dev to another)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = session.user as any
  const { assignedDeveloperId } = await req.json()

  if (!assignedDeveloperId?.trim()) {
    return NextResponse.json({ error: 'Missing assignedDeveloperId' }, { status: 400 })
  }

  try {
    // Get requirement + check access
    const requirement = await prisma.requirement.findUnique({
      where: { id: params.id },
      include: {
        tenant: { select: { id: true, name: true, partnerAccountId: true } },
        user: { select: { id: true, email: true } },
        assignedDeveloper: { select: { id: true, firstName: true, preferredName: true, email: true } },
      },
    })

    if (!requirement) {
      return NextResponse.json({ error: 'Requirement not found' }, { status: 404 })
    }

    // Access check: user must be tenant admin OR superadmin
    const isAdmin = user.role === 'superadmin' || (user.role === 'tenant_admin' && user.tenantId === requirement.tenantId)
    const isPartnerAdmin = user.role === 'partner_admin' && requirement.tenant?.partnerAccountId

    if (!isAdmin && !isPartnerAdmin) {
      return NextResponse.json({ error: 'Only admins can assign requirements' }, { status: 403 })
    }

    // Get the developer to assign to (must be same tenant context)
    const assignTo = await prisma.user.findUnique({
      where: { id: assignedDeveloperId },
      select: { id: true, tenantId: true, firstName: true, preferredName: true, email: true, role: true },
    })

    if (!assignTo) {
      return NextResponse.json({ error: 'Developer not found' }, { status: 404 })
    }

    // Access check: developer must be in same tenant (or be superadmin for partner context)
    if (assignTo.tenantId !== requirement.tenantId && assignTo.role !== 'superadmin') {
      return NextResponse.json({ error: 'Developer not in this tenant' }, { status: 403 })
    }

    // Update assignment
    const updated = await prisma.requirement.update({
      where: { id: params.id },
      data: {
        assignedDeveloperId: assignedDeveloperId,
        assignedAt: new Date(),
        unableToCompleteAt: null, // clear unable status when reassigned
      },
      include: {
        tenant: { select: { name: true, partnerAccountId: true } },
        assignedDeveloper: { select: { firstName: true, preferredName: true, email: true } },
      },
    })

    // Get partner branding if applicable
    let fromEmail: string | null = null
    if (updated.tenant?.partnerAccountId) {
      fromEmail = await getPartnerFromEmail(requirement.tenantId)
    }

    // Notify developer
    const devName = assignTo.preferredName ?? assignTo.firstName
    await notifyRequirementAssigned({
      to: assignTo.email,
      devName,
      requirementTitle: requirement.title,
      tenantName: updated.tenant?.name ?? '',
      requirementId: requirement.id,
      fromEmail,
    })

    return NextResponse.json({ requirement: updated }, { status: 200 })
  } catch (err: any) {
    console.error('[assign requirement]', err?.message)
    return NextResponse.json({ error: 'Database error', details: err?.message }, { status: 500 })
  }
}
