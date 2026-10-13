import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { validateSpec } from '@/lib/dashboards/validate'
import { getDashboardScope, toClient, OWNER_SELECT } from '@/lib/dashboards/access'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** GET: own or shared-in-tenant. PUT/DELETE: owner only. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const scope = await getDashboardScope(req.nextUrl.searchParams.get('tenantId'))
  if (scope instanceof NextResponse) return scope
  const d = await prisma.dashboard.findFirst({
    where: { id, tenantId: scope.tenantId, OR: [{ ownerUserId: scope.userId }, { sharedWithTenant: true }] },
    include: { owner: OWNER_SELECT },
  })
  if (!d) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ dashboard: toClient(d, scope) })
}

/** PUT { name?, spec?, sharedWithTenant?, isHome? } */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const scope = await getDashboardScope(body?.tenantId)
  if (scope instanceof NextResponse) return scope

  const existing = await prisma.dashboard.findFirst({ where: { id, tenantId: scope.tenantId, ownerUserId: scope.userId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const data: Record<string, unknown> = {}
  if (body?.spec !== undefined || body?.name !== undefined) {
    const spec = body?.spec !== undefined ? body.spec : existing.spec
    const name = typeof body?.name === 'string' ? body.name.trim() : existing.name
    const v = validateSpec({ ...(spec as object), name })
    if (!v.ok) return NextResponse.json({ error: 'invalid_spec', errors: v.errors }, { status: 400 })
    data.spec = v.spec
    data.name = v.spec.name
  }
  if (typeof body?.sharedWithTenant === 'boolean') data.sharedWithTenant = body.sharedWithTenant
  const setHome = typeof body?.isHome === 'boolean' ? body.isHome : undefined
  if (setHome !== undefined) data.isHome = setHome

  const updated = await prisma.$transaction(async (tx: any) => {
    if (setHome === true) {
      await tx.dashboard.updateMany({ where: { ownerUserId: scope.userId, isHome: true, NOT: { id } }, data: { isHome: false } })
    }
    return tx.dashboard.update({ where: { id }, data })
  })
  return NextResponse.json({ dashboard: toClient(updated, scope) })
}

/** Deleting your home dashboard is "reset to default": with no home, the system pack shows. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const scope = await getDashboardScope(req.nextUrl.searchParams.get('tenantId'))
  if (scope instanceof NextResponse) return scope
  const res = await prisma.dashboard.deleteMany({ where: { id, tenantId: scope.tenantId, ownerUserId: scope.userId } })
  if (res.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
