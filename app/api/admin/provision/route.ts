import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { createTunnel, configureTunnelIngress, createDnsRecord } from '@/lib/cloudflare'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

// POST /api/admin/provision
// Full automated onboarding:
//   1. Create Cloudflare tunnel
//   2. Configure tunnel ingress (hostname → localhost:agentPort)
//   3. Create DNS CNAME record
//   4. Generate API key
//   5. Seed tenant in DB
// Returns: tenant record (installer can then be downloaded via /api/admin/installer/[id])
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { name, tunnelSubdomain, bcInstance, bcCompany, agentPort = 9099 } = body

  if (!name || !tunnelSubdomain) {
    return NextResponse.json({ error: 'name and tunnelSubdomain are required' }, { status: 400 })
  }

  const subdomain = tunnelSubdomain.trim().toLowerCase()
  const hostname  = `${subdomain}-agent.bespoxai.com`
  const tunnelName = `bespoxai-${subdomain}`

  // Check for CF env vars
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_ZONE_ID) {
    return NextResponse.json({ error: 'Cloudflare environment variables not configured (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_ZONE_ID)' }, { status: 500 })
  }

  let tunnelId: string
  const steps: string[] = []

  try {
    // Step 1: Create CF tunnel
    const tunnel = await createTunnel(tunnelName)
    tunnelId = tunnel.id
    steps.push(`✓ Tunnel created: ${tunnelName} (${tunnelId})`)

    // Step 2: Configure ingress (hostname → local agent)
    await configureTunnelIngress(tunnelId, hostname, `http://localhost:${agentPort}`)
    steps.push(`✓ Ingress configured: ${hostname} → localhost:${agentPort}`)

    // Step 3: Create DNS record
    await createDnsRecord(hostname, tunnelId)
    steps.push(`✓ DNS CNAME created: ${hostname}`)

  } catch (cfErr: any) {
    return NextResponse.json({
      error: `Cloudflare provisioning failed: ${cfErr.message}`,
      steps,
    }, { status: 502 })
  }

  // Step 4: Generate API key + create tenant
  const apiKey = crypto.randomBytes(32).toString('base64')

  try {
    const tenant = await prisma.tenant.create({
      data: {
        name:            name.trim(),
        tunnelSubdomain: subdomain,
        bcInstance:      (bcInstance ?? 'BC').trim(),
        bcCompany:       (bcCompany  ?? 'CRONUS International Ltd.').trim(),
        apiKey,
        tunnelId,
      },
    })
    steps.push(`✓ Tenant created in database`)

    return NextResponse.json({
      tenant,
      apiKey,   // shown once to admin
      tunnelId,
      hostname,
      steps,
    })
  } catch (dbErr: any) {
    return NextResponse.json({
      error: `Tenant DB creation failed: ${dbErr.message} (tunnel ${tunnelId} was created in Cloudflare — delete it manually if retrying)`,
      tunnelId,
      steps,
    }, { status: 500 })
  }
}
