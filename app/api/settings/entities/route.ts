import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

function isTenantAdmin(role: string) { return role === 'tenant_admin' || role === 'superadmin' }

// PATCH /api/settings/entities — save entity config toggles
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const role = (session?.user as any)?.role
  if (!session?.user || !isTenantAdmin(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { entityConfig } = body
  if (!entityConfig || typeof entityConfig !== 'object')
    return NextResponse.json({ error: 'entityConfig object required' }, { status: 400 })

  const tenantId = (session.user as any).tenantId
  await (prisma as any).tenant.update({ where: { id: tenantId }, data: { entityConfig } })
  return NextResponse.json({ ok: true, entityConfig })
}
