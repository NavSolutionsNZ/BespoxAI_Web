import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getTenantById } from '@/lib/tenants'

export const dynamic = 'force-dynamic'

function isTenantAdmin(role: string) { return role === 'tenant_admin' || role === 'superadmin' }

// GET /api/settings/diagnose-connection
// Calls the tenant's BCAgent /bespoxai/diagnose endpoint (agent v3.5+) and
// relays its step-by-step connection checklist. Distinct from /api/health,
// which only confirms the agent process itself is reachable through the
// tunnel — this walks the actual BC connection (reachability, auth, company)
// so a failure shows exactly where it broke instead of one opaque timeout.
export async function GET() {
  const session = await getServerSession(authOptions)
  const role = (session?.user as any)?.role
  if (!session?.user || !isTenantAdmin(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const tenantId = (session.user as any).tenantId
  if (!tenantId) return NextResponse.json({ error: 'No tenant' }, { status: 400 })

  const tenant = await getTenantById(tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const url = `${tenant.agentBaseUrl}/bespoxai/diagnose`

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
        error: 'This BCAgent version does not support connection diagnostics yet. Download and reinstall the latest installer from the BC Installer tab.',
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
