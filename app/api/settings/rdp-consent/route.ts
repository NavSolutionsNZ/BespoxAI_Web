import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/api-auth'
import { setRdpConsent } from '@/lib/rdp'

export const dynamic = 'force-dynamic'

// POST /api/settings/rdp-consent  { granted: boolean }
//
// Grants or withdraws consent for remote support (RDP) access to the customer's
// server. This is the customer's decision alone: only their tenant_admin may
// call it — not superadmins, and not partners. Withdrawing clears the stored
// support-account password; the account is removed from the server the next
// time the installer runs.
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

  return NextResponse.json({ rdpConsentAt })
}
