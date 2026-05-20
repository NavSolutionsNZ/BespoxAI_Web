import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

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
        tenant: { select: { name: true } },
      },
    })

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
      tenant: { select: { name: true } },
    },
  })

  return NextResponse.json({ requirement }, { status: 201 })
}
