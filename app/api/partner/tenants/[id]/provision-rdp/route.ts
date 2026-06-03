import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerSession, assertTenantBelongsToPartner } from '@/lib/partner-auth'
import { prisma } from '@/lib/db'
import { addRdpIngress, createRdpDnsRecord } from '@/lib/cloudflare'

export const dynamic = 'force-dynamic'

// POST /api/partner/tenants/[id]/provision-rdp
// Partner admin only. Adds RDP ingress + DNS to the tenant's existing Cloudflare tunnel.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await requirePartnerSession('partner_admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await assertTenantBelongsToPartner(params.id, session.partnerAccountId)
  } catch {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const tenant = await (prisma as any).tenant.findUnique({
    where:  { id: params.id },
    select: { id: true, tunnelId: true, tunnelSubdomain: true, agentPort: true },
  })
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  if (!tenant.tunnelId || !tenant.tunnelSubdomain) {
    return NextResponse.json({ error: 'Tenant has no tunnel — download the installer first' }, { status: 400 })
  }

  const subdomain     = tenant.tunnelSubdomain as string
  const agentPort     = (tenant.agentPort as number) || 9099
  const agentHostname = subdomain + '-agent.bespoxai.com'
  const rdpHostname   = subdomain + '-rdp.bespoxai.com'
  const steps: string[] = []

  try {
    await addRdpIngress(tenant.tunnelId, agentHostname, agentPort, rdpHostname)
    steps.push('RDP ingress added: ' + rdpHostname + ' -> rdp://localhost:3389')
  } catch (e: any) {
    return NextResponse.json({ error: 'Failed to add RDP ingress: ' + e.message }, { status: 502 })
  }

  try {
    await createRdpDnsRecord(rdpHostname, tenant.tunnelId)
    steps.push('DNS record created: ' + rdpHostname)
  } catch (e: any) {
    steps.push('DNS record: ' + e.message + ' (may already exist — continuing)')
  }

  return NextResponse.json({ ok: true, rdpHostname, agentHostname, steps })
}
