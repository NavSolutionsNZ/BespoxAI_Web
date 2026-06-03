import { getServerSession } from 'next-auth'
import { authOptions } from './auth'
import { prisma } from './db'

export type PartnerSession = {
  userId:           string
  partnerAccountId: string
  partnerRole:      string
  partnerSlug:      string
}

/**
 * Validate that the current request has a valid partner session.
 * Pass minRole='partner_admin' to restrict to admins only.
 * Returns null if session is missing or insufficient.
 */
export async function requirePartnerSession(
  minRole?: 'partner_admin'
): Promise<PartnerSession | null> {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  if (!user?.partnerAccountId) return null
  if (minRole === 'partner_admin' && user.partnerRole !== 'partner_admin') return null
  return {
    userId:           user.id,
    partnerAccountId: user.partnerAccountId,
    partnerRole:      user.partnerRole,
    partnerSlug:      user.partnerSlug,
  }
}

/**
 * Assert that a tenant belongs to the given partner account.
 * Throws if not found or not owned — caller should catch and return 403.
 */
export async function assertTenantBelongsToPartner(
  tenantId: string,
  partnerAccountId: string
) {
  const tenant = await (prisma as any).tenant.findFirst({
    where: { id: tenantId, partnerAccountId },
  })
  if (!tenant) throw new Error('Tenant not found or not owned by this partner')
  return tenant
}
