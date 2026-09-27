import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerSession, assertTenantBelongsToPartner } from '@/lib/partner-auth'
import { provisionRdpAccess, RdpError } from '@/lib/rdp-access'
import { logRdpAccess, RDP_PROVISIONING_ENABLED, RDP_PROVISIONING_DISABLED_MESSAGE } from '@/lib/rdp'

export const dynamic = 'force-dynamic'

// POST /api/partner/tenants/[id]/provision-rdp
// Partner admin only. Puts {sub}-rdp.bespoxai.com behind Cloudflare Access
// (One-time PIN + MFA + portal live check), then adds the RDP route and DNS
// to the tenant's tunnel. Requires customer consent. See lib/rdp-access.ts.
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await requirePartnerSession('partner_admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!RDP_PROVISIONING_ENABLED) {
    return NextResponse.json({ error: RDP_PROVISIONING_DISABLED_MESSAGE }, { status: 403 })
  }

  try {
    await assertTenantBelongsToPartner(params.id, session.partnerAccountId)
  } catch {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  try {
    const result = await provisionRdpAccess(params.id)
    await logRdpAccess({ tenantId: params.id, userId: session.userId, userEmail: session.email, action: 'provisioned' })
    return NextResponse.json({ ok: true, ...result })
  } catch (e: any) {
    if (e instanceof RdpError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('[partner/provision-rdp]', e?.message)
    return NextResponse.json({ error: 'RDP provisioning failed' }, { status: 500 })
  }
}
