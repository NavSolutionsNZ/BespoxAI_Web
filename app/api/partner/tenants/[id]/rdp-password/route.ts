import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerSession, assertTenantBelongsToPartner } from '@/lib/partner-auth'
import { prisma } from '@/lib/db'
import { decryptRdpPassword, isEncryptedValue, logRdpAccess } from '@/lib/rdp'
import { canConnectRdp } from '@/lib/rdp-access'

export const dynamic = 'force-dynamic'

// POST /api/partner/tenants/[id]/rdp-password
//
// Reveals the support-account password to a partner user who is allowed to
// connect (the same canConnectRdp() rule Cloudflare Access applies at
// sign-in). The reveal is logged before the password is returned; if the log
// write fails, nothing is disclosed. POST so it is never prefetched or cached.
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const session = await requirePartnerSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await assertTenantBelongsToPartner(params.id, session.partnerAccountId)
  } catch {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const decision = await canConnectRdp(params.id, session.email)
  if (!decision.allowed) {
    return NextResponse.json({ error: 'Remote support access is not available for this client (' + decision.reason + ')' }, { status: 403 })
  }

  const tenant = await (prisma as any).tenant.findFirst({
    where:  { id: params.id },
    select: { id: true, rdpPassword: true },
  })
  if (!tenant?.rdpPassword || !isEncryptedValue(tenant.rdpPassword)) {
    return NextResponse.json({ error: 'No support password yet — download and run the installer after the customer has consented' }, { status: 404 })
  }

  const password = decryptRdpPassword(tenant.rdpPassword)
  await logRdpAccess({ tenantId: tenant.id, userId: session.userId, userEmail: session.email, action: 'reveal' })

  return NextResponse.json({ password }, { headers: { 'Cache-Control': 'no-store' } })
}
