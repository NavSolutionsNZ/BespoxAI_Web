import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { notifyRequirementAssigned } from '@/lib/notifications'

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

    // Direct pipeline only: BespoxAI superadmin assigns on direct tenants.
    // Partner-managed tenants are assigned by the partner via the partner route.
    if (user.role !== 'superadmin') {
      return NextResponse.json({ error: 'Only a superadmin can assign on the direct pipeline' }, { status: 403 })
    }
    if (requirement.tenant?.partnerAccountId) {
      return NextResponse.json({ error: 'Partner-managed tenant: assignment is handled by the partner.' }, { status: 403 })
    }

    // Get the developer to assign to (must be same tenant context)
    const assignTo = await prisma.user.findUnique({
      where: { id: assignedDeveloperId },
      select: { id: true, tenantId: true, firstName: true, preferredName: true, email: true, role: true },
    })

    if (!assignTo) {
      return NextResponse.json({ error: 'Developer not found' }, { status: 404 })
    }

    // Developer must be internal (superadmin/developer) or in the same tenant
    if (assignTo.tenantId !== requirement.tenantId && assignTo.role !== 'superadmin' && assignTo.role !== 'developer') {
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
        tenant: { select: { name: true } },
        assignedDeveloper: { select: { firstName: true, preferredName: true, email: true } },
      },
    })

    // Notify developer (direct pipeline — no partner branding)
    const devName = assignTo.preferredName ?? assignTo.firstName
    await notifyRequirementAssigned({
      to: assignTo.email,
      devName,
      requirementTitle: requirement.title,
      tenantName: updated.tenant?.name ?? '',
      requirementId: requirement.id,
      fromEmail: null,
    })

    return NextResponse.json({ requirement: updated }, { status: 200 })
  } catch (err: any) {
    console.error('[assign requirement]', err?.message)
    return NextResponse.json({ error: 'Database error', details: err?.message }, { status: 500 })
  }
}
