import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { notifyAdminsNewRequirement } from '@/lib/notifications'
import { unstable_cache } from 'next/cache'

export const dynamic = 'force-dynamic'

function sessionGuard(session: any) {
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return null
}

// Cached requirements lookup — 60s TTL per user+pagination key
const getCachedRequirements = unstable_cache(
  async (tenantId: string | null, skip: number, take: number, isSuperadmin: boolean) => {
    const [requirements, total] = await Promise.all([
      prisma.requirement.findMany({
        where: isSuperadmin ? {} : { tenantId: tenantId || undefined },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          user:              { select: { name: true, email: true } },
          tenant:            { select: { name: true, country: true, paymentTermsKey: true } },
          assignedDeveloper: { select: { id: true, firstName: true, preferredName: true, email: true } },
          addenda: {
            orderBy: { createdAt: 'asc' },
            select: { id: true, title: true, status: true, quote: true, createdAt: true, parentId: true },
          },
        },
      }),
      prisma.requirement.count({
        where: isSuperadmin ? {} : { tenantId: tenantId || undefined },
      }),
    ])

    return { requirements, total }
  },
  ['requirements'],
  { revalidate: 60 } // cache for 60 seconds
)

// GET /api/requirements — list requirements for current user's tenant
// superadmin sees all
// Query params: ?skip=0&take=20 (pagination, defaults to first 20)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const guard = sessionGuard(session)
  if (guard) return guard

  const user = session!.user as any
  const isSuperadmin = user.role === 'superadmin'

  // Parse pagination params
  const url = new URL(req.url)
  const skip = Math.max(0, parseInt(url.searchParams.get('skip') || '0'))
  const take = Math.min(100, Math.max(1, parseInt(url.searchParams.get('take') || '20'))) // max 100 per request

  try {
    const { requirements, total } = await getCachedRequirements(
      user.tenantId || null,
      skip,
      take,
      isSuperadmin
    )

    // Sanitize response for non-superadmins
    const sanitised = isSuperadmin
      ? requirements
      : requirements.map(({ devPlan, ...rest }: any) => rest)

    return NextResponse.json({
      requirements: sanitised,
      pagination: { skip, take, total }
    })
  } catch (err: any) {
    console.error('[requirements GET] DB error:', err?.message)
    return NextResponse.json({ error: 'Database error', details: err?.message }, { status: 500 })
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
      tenantId:           user.tenantId,
      userId:             user.id,
      assignedDeveloperId: user.id, // auto-assign to creating user
      title:              title.trim(),
      description:        description.trim(),
      bcArea,
      priority,
      status:             'draft',
    },
    include: {
      user:             { select: { name: true, email: true, firstName: true, preferredName: true } },
      tenant:           { select: { name: true, country: true, paymentTermsKey: true } },
      assignedDeveloper: { select: { id: true, firstName: true, preferredName: true, email: true } },
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
