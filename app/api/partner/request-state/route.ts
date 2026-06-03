import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/partner/request-state
// Returns the persisted connection/upgrade request timestamps for the current tenant.
// Only available to partner-managed client users.
export async function GET() {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  if (!user || !user.managedByPartner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const tenant = await (prisma as any).tenant.findUnique({
    where:  { id: user.tenantId },
    select: {
      connectionRequestedAt:      true,
      connectionRequestedToEmail: true,
      upgradeRequestedAt:         true,
      upgradeRequestedToEmail:    true,
    },
  })
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  return NextResponse.json({
    connectionRequestedAt:      tenant.connectionRequestedAt      ?? null,
    connectionRequestedToEmail: tenant.connectionRequestedToEmail ?? null,
    upgradeRequestedAt:         tenant.upgradeRequestedAt         ?? null,
    upgradeRequestedToEmail:    tenant.upgradeRequestedToEmail    ?? null,
  })
}
