import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerSession } from '@/lib/partner-auth'
import { prisma } from '@/lib/db'

// GET /api/partner/tenants — list all client tenants for this partner
export async function GET(req: NextRequest) {
  const session = await requirePartnerSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const tenants = await (prisma as any).tenant.findMany({
    where: { partnerAccountId: session.partnerAccountId },
    select: {
      id: true,
      name: true,
      tunnelSubdomain: true,
      active: true,
      navProduct: true,
      navVersion: true,
      lastCU: true,
      agentPort: true,
      createdAt: true,
    },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json(tenants)
}
