import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { checkFeatureAccess, checkTierAccess } from '@/lib/tier'

export const MAX_DASHBOARDS_PER_USER = 20

export interface DashboardScope {
  userId: string
  tenantId: string
  isSuperadmin: boolean
}

/**
 * Who is asking, and for which tenant. Customer users are always scoped to
 * their own tenant and need CFO Assistant access. A superadmin may name a
 * tenant (preview/testing) — their own saved dashboards are then filed
 * under that tenant.
 */
export async function getDashboardScope(requestedTenantId?: string | null): Promise<DashboardScope | NextResponse> {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const isSuperadmin = user.role === 'superadmin'

  const tenantId: string | undefined = isSuperadmin && requestedTenantId ? requestedTenantId : user.tenantId
  if (!tenantId) return NextResponse.json({ error: 'No tenant' }, { status: 400 })

  if (!isSuperadmin) {
    const tier = await checkTierAccess(tenantId)
    if (!tier.allowed) return NextResponse.json({ error: 'tier_blocked' }, { status: 402 })
    if (!(await checkFeatureAccess(tenantId, 'assistant'))) {
      return NextResponse.json({ error: 'upgrade_required' }, { status: 402 })
    }
  }
  return { userId: user.id, tenantId, isSuperadmin }
}

/** Shape returned to the client — never leaks other tenants' data. */
export function toClient(d: any, scope: DashboardScope) {
  return {
    id: d.id,
    name: d.name,
    spec: d.spec,
    sharedWithTenant: d.sharedWithTenant,
    isHome: d.isHome,
    updatedAt: d.updatedAt,
    isMine: d.ownerUserId === scope.userId,
    ownerName: d.owner ? (d.owner.preferredName?.trim() || d.owner.firstName?.trim() || 'A colleague') : undefined,
  }
}

export const OWNER_SELECT = { select: { preferredName: true, firstName: true } } as const
