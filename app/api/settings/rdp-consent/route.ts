import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/api-auth'
import { setRdpConsent, logRdpAccess } from '@/lib/rdp'
import { deprovisionRdpAccess } from '@/lib/rdp-access'

export const dynamic = 'force-dynamic'

// POST /api/settings/rdp-consent  { granted: boolean }
//
// Grants or withdraws consent for remote support (RDP) access to the customer's
// server. This is the customer's decision alone: only their tenant_admin may
// call it — not superadmins, and not partners. Withdrawing clears the stored
// support-account password and immediately tears down the RDP route, DNS and
// Access app; the account itself is removed from the server the next time the
// installer runs. (The Access live check also denies as soon as consent is
// gone, so a failed teardown never leaves access open.)
export async function POST(req: NextRequest) {
  const auth = await requireTenant()
  if (auth instanceof NextResponse) return auth

  const user = auth.user as any
  if (user.role !== 'tenant_admin') {
    return NextResponse.json(
      { error: "Only your organisation's administrator can change remote support access." },
      { status: 403 },
    )
  }

  const body = await req.json().catch(() => ({}))
  if (typeof body.granted !== 'boolean') {
    return NextResponse.json({ error: 'granted (boolean) is required' }, { status: 400 })
  }

  const rdpConsentAt = await setRdpConsent({
    tenantId:  user.tenantId,
    userId:    user.id,
    userEmail: user.email ?? '',
    granted:   body.granted,
  })

  let teardownErrors: string[] = []
  if (!body.granted) {
    try {
      const res = await deprovisionRdpAccess(user.tenantId)
      teardownErrors = res.errors
      if (res.removed) {
        await logRdpAccess({ tenantId: user.tenantId, userId: user.id, userEmail: user.email ?? '', action: 'deprovisioned' })
      }
    } catch (e: any) {
      teardownErrors = [e?.message || 'teardown failed']
    }
    if (teardownErrors.length) console.error('[rdp-consent] teardown errors', user.tenantId, teardownErrors)
  }

  return NextResponse.json({ rdpConsentAt })
}
