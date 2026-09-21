import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/admin/entities/[tenantId] — return current entity config
export async function GET(_req: NextRequest, props: { params: Promise<{ tenantId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const tenant = await prisma.tenant.findUnique({
    where: { id: params.tenantId },
    select: { entityConfig: true },
  })
  if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ entityConfig: tenant.entityConfig ?? {} })
}

// PATCH /api/admin/entities/[tenantId] — toggle one entity on/off
// Body: { entity: "Customer", enabled: false }
export async function PATCH(req: NextRequest, props: { params: Promise<{ tenantId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { entity, enabled } = await req.json().catch(() => ({}))
  if (!entity || enabled === undefined)
    return NextResponse.json({ error: 'entity and enabled required' }, { status: 400 })

  const tenant = await prisma.tenant.findUnique({ where: { id: params.tenantId } })
  if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const current = (tenant.entityConfig as Record<string, boolean>) ?? {}
  const updated = { ...current, [entity]: enabled }

  await prisma.tenant.update({
    where: { id: params.tenantId },
    data: { entityConfig: updated },
  })

  return NextResponse.json({ entityConfig: updated })
}
