import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerSession } from '@/lib/partner-auth'
import { prisma } from '@/lib/db'

// GET /api/partner/tenants — list all client tenants for this partner
export async function GET(req: NextRequest) {
  const session = await requirePartnerSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const tenants = await (prisma as any).tenant.findMany({
    where: { partnerAccountId: session.partnerAccountId },
    select: {
      id: true,
      name: true,
      tunnelSubdomain: true,
      active: true,
      navProduct: true,
      navVersion: true,
      lastCU: true,
      agentPort: true,
      createdAt: true,
    },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json(tenants)
}

import crypto from 'crypto'

// POST /api/partner/tenants — create a new client tenant for this partner
// Tunnel is NOT created here — it is auto-provisioned on first installer download
export async function POST(req: NextRequest) {
  const session = await requirePartnerSession('partner_admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const {
    name, tunnelSubdomain,
    navProduct, navVersion, lastCU,
    bcInstance, bcCompany, bcPort, agentPort,
    bcUsername,
    // bcPassword intentionally not destructured — never persisted to DB
    navDatabaseServer, navDatabaseName, navServerInstance, navManagementPort,
    // Test environment
    testNavDatabaseServer, testNavDatabaseName, testNavServerInstance,
    testBcInstance, testBcCompany, testBcPort, testNavManagementPort,
  } = body

  if (!name?.trim() || !tunnelSubdomain?.trim()) {
    return NextResponse.json({ error: 'Company name and subdomain are required' }, { status: 400 })
  }

  const subdomain = tunnelSubdomain.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')

  // Check subdomain not already taken
  const existing = await (prisma as any).tenant.findFirst({ where: { tunnelSubdomain: subdomain } })
  if (existing) {
    return NextResponse.json({ error: 'That subdomain is already in use — choose another' }, { status: 409 })
  }

  const apiKey = crypto.randomBytes(32).toString('base64')

  const tenant = await (prisma as any).tenant.create({
    data: {
      name:               name.trim(),
      tunnelSubdomain:    subdomain,
      apiKey,
      partnerAccountId:   session.partnerAccountId,
      active:             true,
      // BC/NAV product
      ...(navProduct        ? { navProduct }        : {}),
      ...(navVersion        ? { navVersion }        : {}),
      ...(lastCU            ? { lastCU }            : {}),
      // Production environment
      bcInstance:         bcInstance?.trim()  || 'BC',
      bcCompany:          bcCompany?.trim()   || '',
      bcPort:             parseInt(String(bcPort   ?? 8048), 10) || 8048,
      agentPort:          parseInt(String(agentPort ?? 9099), 10) || 9099,
      ...(bcUsername         ? { bcUsername: bcUsername.trim() } : {}),
      ...(navDatabaseServer  ? { navDatabaseServer:  navDatabaseServer.trim()  } : {}),
      ...(navDatabaseName    ? { navDatabaseName:    navDatabaseName.trim()    } : {}),
      ...(navServerInstance  ? { navServerInstance:  navServerInstance.trim()  } : {}),
      navManagementPort:  parseInt(String(navManagementPort ?? 7045), 10) || 7045,
      // Test environment
      ...(testNavDatabaseServer ? { testNavDatabaseServer: testNavDatabaseServer.trim() } : {}),
      ...(testNavDatabaseName   ? { testNavDatabaseName:   testNavDatabaseName.trim()   } : {}),
      ...(testNavServerInstance ? { testNavServerInstance: testNavServerInstance.trim() } : {}),
      ...(testBcInstance        ? { testBcInstance:        testBcInstance.trim()        } : {}),
      ...(testBcCompany         ? { testBcCompany:         testBcCompany.trim()         } : {}),
      ...(testBcPort            ? { testBcPort:  parseInt(String(testBcPort),  10)      } : {}),
      testNavManagementPort: parseInt(String(testNavManagementPort ?? 7045), 10) || 7045,
    },
  })

  return NextResponse.json(tenant, { status: 201 })
}
