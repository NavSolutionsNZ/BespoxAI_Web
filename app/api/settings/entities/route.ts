import { NextRequest, NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/api-auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// PATCH /api/settings/entities — save entity config toggles
export async function PATCH(req: NextRequest) {
  const session = await requireTenantAdmin()
  if (session instanceof NextResponse) return session

  const body = await req.json().catch(() => ({}))
  const { entityConfig } = body
  if (!entityConfig || typeof entityConfig !== 'object')
    return NextResponse.json({ error: 'entityConfig object required' }, { status: 400 })

  const tenantId = (session.user as any).tenantId
  await (prisma as any).tenant.update({ where: { id: tenantId }, data: { entityConfig } })
  return NextResponse.json({ ok: true, entityConfig })
}
