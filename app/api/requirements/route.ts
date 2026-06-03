import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { notifyAdminsNewRequirement } from '@/lib/notifications'

export const dynamic = 'force-dynamic'

function sessionGuard(session: any) {
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return null
}

// GET /api/requirements — list requirements for current user's tenant
// superadmin sees all
export async function GET() {
  const session = await getServerSession(authOptions)
  const guard = sessionGuard(session)
  if (guard) return guard

  const user = session!.user as any
  const isSuperadmin = user.role === 'superadmin'

  try {
    const requirements = await prisma.requirement.findMany({
      where: isSuperadmin ? {} : { tenantId: user.tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        user:   { select: { name: true, email: true } },
        tenant: { select: { name: true, country: true, paymentTermsKey: true } },
        addenda: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, title: true, status: true, quote: true, createdAt: true, parentId: true },
        },
      },
    })

    // Return all requirements (incl. addenda) so customers can navigate into them.
    // The UI filters the displayed list to top-level only; addenda are reachable via parent's addenda list.
    const sanitised = isSuperadmin
      ? requirements
      : requirements.map(({ devPlan, ...rest }: any) => rest)

    return NextResponse.json({ requirements: sanitised })
  } catch (err: any) {
    console.error('[requirements GET] DB error:', err?.message)
    return NextResponse.json({ error: 'Database error — run npx prisma db push', details: err?.message }, { status: 500 })
  }
}

// POST /api/requirements — create a new requirement
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const guard = sessionGuard(session)
  if (guard) return guard

  const user = session!.user as any
  const body = await req.json()

  const { title, description, bcArea, priority } = body

  if (!user.tenantId) {
    return NextResponse.json({ error: 'Partner accounts cannot create requirements directly' }, { status: 403 })
  }

  if (!title?.trim() || !description?.trim() || !bcArea || !priority) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const requirement = await prisma.requirement.create({
    data: {
      tenantId:    user.tenantId,
      userId:      user.id,
      title:       title.trim(),
      description: description.trim(),
      bcArea,
      priority,
      status:      'draft',
    },
    include: {
      user:   { select: { name: true, email: true } },
      tenant: { select: { name: true, country: true, paymentTermsKey: true } },
    },
  })

  // Notify superadmins — fire and forget
  notifyAdminsNewRequirement({
    requirementId: requirement.id,
    title:         requirement.title,
    tenantName:    (requirement as any).tenant?.name ?? '',
    customerName:  (requirement as any).user?.name ?? (requirement as any).user?.email ?? '',
    customerEmail: (requirement as any).user?.email ?? '',
  })

  return NextResponse.json({ requirement }, { status: 201 })
}
