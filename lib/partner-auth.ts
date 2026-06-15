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

/**
 * Assert that the partner account is on the self_serve tier — i.e. entitled to
 * the in-portal requirements development tooling (feasibility, dev-plan,
 * dev-notes, coding-assistant). Referral-tier partners hand requirements off to
 * BespoxAI to manage directly with the customer, so they get a 403 on these
 * routes. Throws if not self_serve — caller should catch and return 403.
 */
export async function assertPartnerCanDevelop(partnerAccountId: string) {
  const account = await (prisma as any).partnerAccount.findFirst({
    where:  { id: partnerAccountId },
    select: { partnerTier: true },
  })
  if (!account) throw new Error('Partner account not found')
  if (account.partnerTier === 'referral') {
    throw new Error('This requirement is managed directly by BespoxAI on the referral tier.')
  }
  return account
}

/**
 * Return the partner account's tier ('self_serve' | 'referral'). Defaults to
 * 'self_serve' if the account or column can't be read, matching the schema
 * default. Used to tier-gate which fields (e.g. devPlan) are returned.
 */
export async function getPartnerTier(partnerAccountId: string): Promise<string> {
  try {
    const account = await (prisma as any).partnerAccount.findFirst({
      where:  { id: partnerAccountId },
      select: { partnerTier: true },
    })
    return account?.partnerTier ?? 'self_serve'
  } catch {
    return 'self_serve'
  }
}
