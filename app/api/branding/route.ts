import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { resolveBranding, DEFAULT_BRANDING } from '@/lib/branding'
import { unstable_cache } from 'next/cache'

export const dynamic = 'force-dynamic'

// Cached branding lookup — returns the same branding for the same user for 60 seconds
const getCachedBranding = unstable_cache(
  async (userId: string, partnerAccountId?: string, tenantId?: string) => {
    // Partner user — use their own PartnerAccount branding
    if (partnerAccountId) {
      const partner = await (prisma as any).partnerAccount.findUnique({
        where: { id: partnerAccountId },
        select: { brandName: true, logoUrl: true, isWhiteLabel: true, agentBrandName: true },
      })
      return resolveBranding(partner)
    }

    // Client user managed by a partner — look up tenant → partnerAccount
    if (tenantId) {
      const tenant = await (prisma as any).tenant.findUnique({
        where: { id: tenantId },
        select: {
          partnerAccount: {
            select: { brandName: true, logoUrl: true, isWhiteLabel: true, agentBrandName: true },
          },
        },
      })
      return resolveBranding(tenant?.partnerAccount ?? null)
    }

    // Default branding
    return DEFAULT_BRANDING
  },
  ['branding'], // cache key prefix
  { revalidate: 60, tags: ['branding'] } // cache for 60 seconds, bustable via revalidateTag('branding')
)

// GET /api/branding
// Returns resolved BrandingConfig for the authenticated user.
// - managedByPartner users: returns partner branding (if isWhiteLabel)
// - Partner users: returns their own partner branding (if isWhiteLabel)
// - All others: returns DEFAULT_BRANDING
// 
// Response is cached for 60 seconds per user to avoid repeated session lookups.
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json(DEFAULT_BRANDING)

  const user = session.user as any
  const userId = user.id || 'anonymous'
  
  try {
    const branding = await getCachedBranding(
      userId,
      user.partnerAccountId,
      user.tenantId
    )
    return NextResponse.json(branding)
  } catch (error) {
    console.error('Error fetching branding:', error)
    return NextResponse.json(DEFAULT_BRANDING)
  }
}
