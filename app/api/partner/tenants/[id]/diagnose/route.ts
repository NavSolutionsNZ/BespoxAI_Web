import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerSession, assertTenantBelongsToPartner } from '@/lib/partner-auth'

export const dynamic = 'force-dynamic'

// GET /api/partner/tenants/[id]/diagnose
// Partner equivalent of api/settings/diagnose-connection — proxies the
// managed tenant's BCAgent GET /bespoxai/diagnose (agent v3.5+). Read-only
// diagnostic, so any partner session member may call it (matches the GET
// tenant-detail route's access level, not the partner_admin-only installer
// POST).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await requirePartnerSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let tenant: any
  try {
    tenant = await assertTenantBelongsToPartner(params.id, session.partnerAccountId)
  } catch {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  if (!tenant.tunnelSubdomain) {
    return NextResponse.json({ ok: false, error: 'No tunnel configured — generate the installer first.' })
  }

  const url = `https://${tenant.tunnelSubdomain}-agent.bespoxai.com/bespoxai/diagnose`

  try {
    const res = await fetch(url, {
      headers: { 'X-BespoxAI-Key': tenant.apiKey },
      signal: AbortSignal.timeout(20_000),
    })

    if (res.status === 404) {
      // Agent predates v3.5 (no /bespoxai/diagnose endpoint yet)
      return NextResponse.json({
        ok: false,
        agentTooOld: true,
        error: 'This BCAgent version does not support connection diagnostics yet. Download and reinstall the latest installer from the BCAgent tab.',
      })
    }

    const body = await res.json().catch(() => null)
    if (!res.ok || !body) {
      return NextResponse.json({ ok: false, error: `Agent returned HTTP ${res.status}` }, { status: 200 })
    }
    return NextResponse.json(body)
  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      error: 'Could not reach the agent: ' + err.message,
    }, { status: 200 })
  }
}
