/**
 * POST /api/admin/provision-rdp  { tenantId }
 *
 * Superadmin only. Puts {subdomain}-rdp.bespoxai.com behind a Cloudflare
 * Access app (One-time PIN + MFA + portal live check), then adds the RDP
 * route and DNS record to the tenant's tunnel. Requires customer consent.
 * See lib/rdp-access.ts.
 *
 * Not gated by RDP_PROVISIONING_ENABLED: that switch only controls partner
 * provisioning, so superadmins can still provision if it is turned off.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/api-auth'
import { provisionRdpAccess, RdpError } from '@/lib/rdp-access'
import { logRdpAccess } from '@/lib/rdp'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const auth = await requireSuperadmin()
  if (auth instanceof NextResponse) return auth

  const { tenantId } = await req.json().catch(() => ({}))
  if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })

  try {
    const result = await provisionRdpAccess(tenantId)
    await logRdpAccess({
      tenantId,
      userId:    (auth.user as any).id,
      userEmail: auth.user?.email ?? '',
      action:    'provisioned',
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (e: any) {
    if (e instanceof RdpError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('[admin/provision-rdp]', e?.message)
    return NextResponse.json({ error: 'RDP provisioning failed' }, { status: 500 })
  }
}
