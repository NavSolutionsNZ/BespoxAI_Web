import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

function isTenantAdmin(role: string) {
  return role === 'tenant_admin' || role === 'superadmin'
}

// ── DEBUG MODE ────────────────────────────────────────────────────────────────
// Set SETTINGS_DEBUG=true in .env.local to test without a live tenant.
// Remove this block (and _debug fields) before going to production.
const DEBUG = process.env.SETTINGS_DEBUG === 'true'
const DEBUG_TENANT = {
  id: 'debug-tenant-001', name: 'Demo Company Ltd',
  tunnelSubdomain: 'demo', bcInstance: 'BC', bcCompany: 'Demo Company Ltd',
  active: true, country: 'NZ',
  entityConfig: { Customer: true, Vendor: true, Item: true, SalesInvoice: true,
    PurchaseInvoice: true, GeneralLedgerEntry: true, CustomerLedgerEntry: true,
    VendorLedgerEntry: true, SalesOrder: false, PurchaseOrder: false,
    ItemLedgerEntry: true, BankAccount: true, GLAccount: true },
  tunnelId: 'debug-tunnel-id', createdAt: '2026-01-15T00:00:00.000Z',
  navProduct: 'BC', navVersion: 'Business Central 2024 Wave 2 (BC25)',
  lastCU: 'CU2', bcPort: 8048, agentPort: 8080,
  _debug: true,
}
// ── END DEBUG ─────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await getServerSession(authOptions)
  const role = (session?.user as any)?.role
  if (!session?.user || !isTenantAdmin(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // ── DEBUG ──
  if (DEBUG) return NextResponse.json({ tenant: DEBUG_TENANT })
  // ── END DEBUG ──

  const tenantId = (session.user as any).tenantId
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true, name: true, tunnelSubdomain: true, bcInstance: true,
      bcCompany: true, active: true, country: true, entityConfig: true,
      tunnelId: true, createdAt: true,
      navProduct: true, navVersion: true, lastCU: true,
      bcPort: true, agentPort: true,
    },
  })
  if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ tenant })
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const role = (session?.user as any)?.role
  if (!session?.user || !isTenantAdmin(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // ── DEBUG ──
  if (DEBUG) return NextResponse.json({ tenant: DEBUG_TENANT, _debug: true })
  // ── END DEBUG ──

  const tenantId = (session.user as any).tenantId
  const body = await req.json().catch(() => ({}))
  const { country, bcPort, agentPort, navProduct, navVersion, lastCU, bcInstance, bcCompany } = body

  const data: Record<string, any> = {}
  if (country    !== undefined) { if (typeof country !== 'string' || country.length > 4) return NextResponse.json({ error: 'Invalid country' }, { status: 400 }); data.country = country.toUpperCase() }
  if (bcPort     !== undefined) { const p = parseInt(bcPort, 10);    if (isNaN(p) || p < 1 || p > 65535) return NextResponse.json({ error: 'Invalid bcPort' }, { status: 400 }); data.bcPort = p }
  if (agentPort  !== undefined) { const p = parseInt(agentPort, 10); if (isNaN(p) || p < 1 || p > 65535) return NextResponse.json({ error: 'Invalid agentPort' }, { status: 400 }); data.agentPort = p }
  if (navProduct !== undefined) data.navProduct = navProduct || null
  if (navVersion !== undefined) data.navVersion = navVersion || null
  if (lastCU     !== undefined) data.lastCU     = lastCU     || null
  if (bcInstance !== undefined) data.bcInstance = bcInstance || null
  if (bcCompany  !== undefined) data.bcCompany  = bcCompany  || null
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const tenant = await (prisma as any).tenant.update({ where: { id: tenantId }, data })
  return NextResponse.json({ tenant })
}
