import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerSession, assertTenantBelongsToPartner } from '@/lib/partner-auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Explicit whitelist — this response reaches every partner user, including
// partner_developer. It must never include apiKey (the BCAgent credential, which
// would let the caller bypass partnerCanDeploy by calling the agent directly) or
// rdpPassword (local Administrator on the client's server). Add fields here only
// if the partner tenant page actually reads them.
const PARTNER_TENANT_SELECT = {
  id: true, name: true, tunnelSubdomain: true, active: true, tier: true, tunnelId: true,
  navProduct: true, navVersion: true, lastCU: true,
  bcInstance: true, bcCompany: true, bcPort: true, agentPort: true,
  bcUsername: true, bcAuthMode: true, serviceAccountUser: true,
  navDatabaseServer: true, navDatabaseName: true, navServerInstance: true, navManagementPort: true,
  testNavDatabaseServer: true, testNavDatabaseName: true, testNavServerInstance: true, testNavManagementPort: true,
  testBcInstance: true, testBcCompany: true, testBcPort: true,
  rdpConsentAt: true, rdpProvisionedAt: true,
  createdAt: true,
} as const

// GET /api/partner/tenants/[id] — single tenant detail for partner
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await requirePartnerSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const tenantRaw = await (prisma as any).tenant.findFirst({
      where:  { id: params.id, partnerAccountId: session.partnerAccountId },
      select: PARTNER_TENANT_SELECT,
    })
    if (!tenantRaw) throw new Error('Not found')
    const tenant = tenantRaw

    // RDP panel: whether a support password exists (never the value) and the
    // support account's name, which follows the installer's brand naming.
    const rdpRow = await (prisma as any).tenant.findFirst({
      where:  { id: params.id },
      select: { rdpPassword: true, partnerAccount: { select: { isWhiteLabel: true, agentBrandName: true } } },
    })
    const brand = (rdpRow?.partnerAccount?.isWhiteLabel && rdpRow?.partnerAccount?.agentBrandName)
      ? rdpRow.partnerAccount.agentBrandName
      : 'BespoxAI'
    const rdpHasPassword = !!rdpRow?.rdpPassword
    const rdpSupportUser = brand + '-Support'

    const users = await (prisma as any).user.findMany({
      where:   { tenantId: params.id, active: true },
      select:  { id: true, name: true, firstName: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json({ ...tenant, rdpHasPassword, rdpSupportUser, users })
  } catch {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }
}
