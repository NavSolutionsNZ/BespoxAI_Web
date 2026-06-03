import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerSession, assertTenantBelongsToPartner } from '@/lib/partner-auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/partner/tenants/[id] — single tenant detail for partner
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await requirePartnerSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const tenant = await assertTenantBelongsToPartner(params.id, session.partnerAccountId)

    const users = await (prisma as any).user.findMany({
      where:   { tenantId: params.id, active: true },
      select:  { id: true, name: true, firstName: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json({ ...tenant, users })
  } catch {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }
}
