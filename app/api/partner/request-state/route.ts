import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { unstable_cache } from 'next/cache'

export const dynamic = 'force-dynamic'

const getCachedRequestState = unstable_cache(
  async (tenantId: string) => {
    const tenant = await (prisma as any).tenant.findUnique({
      where:  { id: tenantId },
      select: {
        connectionRequestedAt:      true,
        connectionRequestedToEmail: true,
        upgradeRequestedAt:         true,
        upgradeRequestedToEmail:    true,
      },
    })
    return tenant
  },
  ['request-state'],
  { revalidate: 60 }
)

// GET /api/partner/request-state
// Returns the persisted connection/upgrade request timestamps for the current tenant.
// Only available to partner-managed client users.
// Response cached for 60s per tenant.
export async function GET() {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  if (!user || !user.managedByPartner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const tenant = await getCachedRequestState(user.tenantId)
    if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

    return NextResponse.json({
      connectionRequestedAt:      tenant.connectionRequestedAt      ?? null,
      connectionRequestedToEmail: tenant.connectionRequestedToEmail ?? null,
      upgradeRequestedAt:         tenant.upgradeRequestedAt         ?? null,
      upgradeRequestedToEmail:    tenant.upgradeRequestedToEmail    ?? null,
    })
  } catch (error) {
    console.error('[request-state] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
