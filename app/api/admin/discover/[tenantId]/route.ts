import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { BC_ENTITIES } from '@/lib/bc-entities'

export const dynamic = 'force-dynamic'

// GET /api/admin/discover/[tenantId]
// Fetches $metadata from the tenant's BCAgent and returns:
//   - available:     entities in our catalogue AND published in this BC
//   - missing:       entities in our catalogue but NOT published in this BC
//   - uncatalogued:  entities published in BC but NOT in our catalogue
export async function GET(_req: NextRequest, { params }: { params: { tenantId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const tenant = await prisma.tenant.findUnique({ where: { id: params.tenantId } })
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  // bcInstance is nullable with no fake default — fail clearly instead of
  // building a URL with a literal "null" segment.
  if (!tenant.bcInstance) return NextResponse.json({ error: 'BC Instance is not configured for this tenant yet' }, { status: 400 })

  const metaUrl = `https://${tenant.tunnelSubdomain}-agent.bespoxai.com/${tenant.bcInstance}/ODataV4/$metadata`

  let bcEntityNames: string[] = []
  let fetchError: string | null = null

  try {
    const res = await fetch(metaUrl, {
      headers: { 'X-BespoxAI-Key': tenant.apiKey, Accept: 'application/xml,text/xml,*/*' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const xml = await res.text()
    // Extract all EntitySet Name="..." from the EDMX metadata
    const re = /EntitySet\s+Name="([^"]+)"/g
    const names: string[] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(xml)) !== null) names.push(m[1])
    bcEntityNames = Array.from(new Set(names))
  } catch (e: any) {
    fetchError = e.message
  }

  const catalogueNames = Object.keys(BC_ENTITIES)
  const bcSet = new Set(bcEntityNames)
  const catSet = new Set(catalogueNames)

  // Current entity config for this tenant
  const config: Record<string, boolean> = (tenant.entityConfig as any) ?? {}

  const available = catalogueNames
    .filter(n => bcSet.has(n))
    .map(n => ({
      name:        n,
      description: (BC_ENTITIES as any)[n].description,
      enabled:     config[n] !== false, // default true
      inBC:        true,
      inCatalogue: true,
    }))

  const missing = catalogueNames
    .filter(n => !bcSet.has(n))
    .map(n => ({
      name:        n,
      description: (BC_ENTITIES as any)[n].description,
      enabled:     false,
      inBC:        false,
      inCatalogue: true,
    }))

  const uncatalogued = bcEntityNames
    .filter(n => !catSet.has(n))
    .map(n => ({
      name:        n,
      description: 'Not yet in BespoxAI catalogue',
      enabled:     false,
      inBC:        true,
      inCatalogue: false,
    }))

  return NextResponse.json({ available, missing, uncatalogued, fetchError, totalInBC: bcEntityNames.length })
}
