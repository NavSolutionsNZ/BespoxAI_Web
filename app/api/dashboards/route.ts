import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { DEFAULT_CFO_PACK } from '@/lib/dashboards/default-pack'
import { validateSpec } from '@/lib/dashboards/validate'
import { getDashboardScope, toClient, OWNER_SELECT, MAX_DASHBOARDS_PER_USER } from '@/lib/dashboards/access'

export const dynamic = 'force-dynamic'

/**
 * GET  /api/dashboards[?tenantId=]  → { default, mine[], shared[] }
 * POST /api/dashboards              → create { name, spec, isHome?, cloneFromId? }
 *   cloneFromId copies a dashboard the caller can see (their own or shared in-tenant).
 *   With neither spec nor cloneFromId, the system default pack is copied.
 */
export async function GET(req: NextRequest) {
  const scope = await getDashboardScope(req.nextUrl.searchParams.get('tenantId'))
  if (scope instanceof NextResponse) return scope

  const [mine, shared] = await Promise.all([
    prisma.dashboard.findMany({
      where: { tenantId: scope.tenantId, ownerUserId: scope.userId },
      orderBy: [{ isHome: 'desc' }, { updatedAt: 'desc' }],
    }),
    prisma.dashboard.findMany({
      where: { tenantId: scope.tenantId, sharedWithTenant: true, NOT: { ownerUserId: scope.userId } },
      include: { owner: OWNER_SELECT },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    }),
  ])

  return NextResponse.json({
    default: { name: DEFAULT_CFO_PACK.name, spec: DEFAULT_CFO_PACK },
    mine: mine.map((d: any) => toClient(d, scope)),
    shared: shared.map((d: any) => toClient(d, scope)),
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const scope = await getDashboardScope(body?.tenantId)
  if (scope instanceof NextResponse) return scope

  const count = await prisma.dashboard.count({ where: { tenantId: scope.tenantId, ownerUserId: scope.userId } })
  if (count >= MAX_DASHBOARDS_PER_USER) {
    return NextResponse.json({ error: 'limit_reached', message: 'You can have up to ' + MAX_DASHBOARDS_PER_USER + ' dashboards.' }, { status: 400 })
  }

  let spec: unknown = body?.spec
  if (typeof body?.cloneFromId === 'string' && body.cloneFromId) {
    const src = await prisma.dashboard.findFirst({
      where: {
        id: body.cloneFromId, tenantId: scope.tenantId,
        OR: [{ ownerUserId: scope.userId }, { sharedWithTenant: true }],
      },
    })
    if (!src) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    spec = src.spec
  }
  if (spec === undefined) spec = DEFAULT_CFO_PACK

  const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : (spec as any)?.name
  const v = validateSpec({ ...(spec as object), name })
  if (!v.ok) return NextResponse.json({ error: 'invalid_spec', errors: v.errors }, { status: 400 })

  const makeHome = body?.isHome === true
  const created = await prisma.$transaction(async (tx: any) => {
    if (makeHome) {
      await tx.dashboard.updateMany({ where: { ownerUserId: scope.userId, isHome: true }, data: { isHome: false } })
    }
    return tx.dashboard.create({
      data: {
        tenantId: scope.tenantId, ownerUserId: scope.userId,
        name: v.spec.name, spec: v.spec as any, isHome: makeHome,
      },
    })
  })
  return NextResponse.json({ dashboard: toClient(created, scope) }, { status: 201 })
}
