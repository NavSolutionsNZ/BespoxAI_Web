/**
 * POST /api/admin/provision-rdp
 *
 * Superadmin only. Adds the RDP ingress rule + DNS record to a tenant's
 * existing Cloudflare tunnel so the BespoxAI-Support Windows account is
 * reachable via {subdomain}-rdp.bespoxai.com.
 *
 * Isolated from the main tunnel provisioning flow — safe to test independently.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { prisma }                    from '@/lib/db'
import { addRdpIngress, createRdpDnsRecord } from '@/lib/cloudflare'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { tenantId } = await req.json().catch(() => ({}))
  if (!tenantId)
    return NextResponse.json({ error: 'tenantId required' }, { status: 400 })

  const tenant = await (prisma as any).tenant.findUnique({
    where:  { id: tenantId },
    select: { id: true, tunnelId: true, tunnelSubdomain: true, agentPort: true },
  })
  if (!tenant)
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  if (!tenant.tunnelId || !tenant.tunnelSubdomain)
    return NextResponse.json({ error: 'Tenant has no tunnel — provision the main tunnel first' }, { status: 400 })

  const subdomain    = tenant.tunnelSubdomain as string
  const agentPort    = (tenant.agentPort as number) || 9099
  const agentHostname = `${subdomain}-agent.bespoxai.com`
  const rdpHostname   = `${subdomain}-rdp.bespoxai.com`
  const steps: string[] = []

  try {
    await addRdpIngress(tenant.tunnelId, agentHostname, agentPort, rdpHostname)
    steps.push(`✓ RDP ingress added: ${rdpHostname} → rdp://localhost:3389`)
  } catch (e: any) {
    return NextResponse.json({ error: `Failed to add RDP ingress: ${e.message}` }, { status: 502 })
  }

  try {
    await createRdpDnsRecord(rdpHostname, tenant.tunnelId)
    steps.push(`✓ DNS record created: ${rdpHostname}`)
  } catch (e: any) {
    // DNS record creation may fail if record already exists — not fatal
    steps.push(`⚠ DNS record: ${e.message} (may already exist — continuing)`)
  }

  return NextResponse.json({
    ok:          true,
    rdpHostname,
    agentHostname,
    steps,
  })
}
