import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/admin/tenants/[id]/diagnose
// Superadmin equivalent of api/settings/diagnose-connection — proxies the
// target tenant's BCAgent GET /bespoxai/diagnose (agent v3.5+) so admin can
// see exactly where a "can't connect" report breaks (reachable/auth/company)
// without RDPing into the customer's server. Mirrors the direct-customer
// route's response shape and 404 handling.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const tenant = await prisma.tenant.findUnique({ where: { id: params.id } })
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
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
        error: 'This BCAgent version does not support connection diagnostics yet. Regenerate and reinstall the installer.',
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
