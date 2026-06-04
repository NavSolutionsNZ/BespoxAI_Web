import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { resolveBranding, DEFAULT_BRANDING } from '@/lib/branding'

export const dynamic = 'force-dynamic'

// GET /api/branding
// Returns resolved BrandingConfig for the authenticated user.
// - managedByPartner users: returns partner branding (if isWhiteLabel)
// - Partner users: returns their own partner branding (if isWhiteLabel)
// - All others: returns DEFAULT_BRANDING
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json(DEFAULT_BRANDING)

  const user = session.user as any

  // Partner user — use their own PartnerAccount branding
  if (user.partnerAccountId) {
    const partner = await (prisma as any).partnerAccount.findUnique({
      where: { id: user.partnerAccountId },
      select: { brandName: true, logoUrl: true, primaryColour: true, secondaryColour: true, isWhiteLabel: true, agentBrandName: true },
    })
    return NextResponse.json(resolveBranding(partner))
  }

  // Client user managed by a partner — look up tenant → partnerAccount
  if (user.managedByPartner && user.tenantId) {
    const tenant = await (prisma as any).tenant.findUnique({
      where: { id: user.tenantId },
      select: {
        partnerAccount: {
          select: { brandName: true, logoUrl: true, primaryColour: true, secondaryColour: true, isWhiteLabel: true, agentBrandName: true },
        },
      },
    })
    return NextResponse.json(resolveBranding(tenant?.partnerAccount ?? null))
  }

  // Direct tenant or superadmin — default BespoxAI branding
  return NextResponse.json(DEFAULT_BRANDING)
}
