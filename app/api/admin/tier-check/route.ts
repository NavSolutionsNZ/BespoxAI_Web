import { NextRequest, NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/api-auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await requireSuperadmin()
  if (session instanceof NextResponse) return session

  const tenants = await prisma.tenant.findMany({
    select: {
      id: true,
      name: true,
      tunnelSubdomain: true,
      tier: true,
      trialEndsAt: true,
      active: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  const now = new Date()

  const report = tenants.map(t => {
    const expired = t.tier === 'trial' && t.trialEndsAt && new Date(t.trialEndsAt) < now
    const daysLeft = t.trialEndsAt
      ? Math.ceil((new Date(t.trialEndsAt).getTime() - now.getTime()) / 86400000)
      : null

    return {
      name: t.name,
      subdomain: t.tunnelSubdomain,
      tier: t.tier,
      trialEndsAt: t.trialEndsAt,
      daysLeft: t.tier === 'trial' ? daysLeft : null,
      status: expired ? '⛔ TRIAL EXPIRED' : t.tier === 'trial' ? '⏳ TRIAL ACTIVE' : '✅ PAID',
      active: t.active,
    }
  })

  return NextResponse.json({ tenants: report, checkedAt: now })
}
