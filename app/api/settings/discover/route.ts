import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/api-auth'
import { prisma } from '@/lib/db'
import { getTenantById, buildODataUrl } from '@/lib/tenants'

export const dynamic = 'force-dynamic'

// POST /api/settings/discover — query BC OData $metadata to find published entities
export async function POST() {
  const session = await requireTenantAdmin()
  if (session instanceof NextResponse) return session

  const tenantId = (session.user as any).tenantId
  const tenant = await getTenantById(tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not configured' }, { status: 404 })
  if (!tenant.bcInstance) return NextResponse.json({ error: 'BC Instance is not configured yet — set it in Settings first' }, { status: 400 })

  // Fetch OData $metadata — returns XML listing all published entity sets
  // NOTE: $metadata lives at the OData service root, NOT under Company(x)/
  // buildODataUrl() always appends Company(x)/ so we build the URL manually here.
  const metadataUrl = tenant.agentBaseUrl + '/' + tenant.bcInstance + '/ODataV4/$metadata'
  let metadataXml: string
  try {
    const res = await fetch(metadataUrl, {
      headers: { 'X-BespoxAI-Key': tenant.apiKey, Accept: 'application/xml' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return NextResponse.json({ error: `BC metadata returned ${res.status}` }, { status: 502 })
    metadataXml = await res.text()
  } catch (e: any) {
    return NextResponse.json({ error: `BCAgent unreachable: ${e.message}` }, { status: 502 })
  }

  // Parse EntitySet names from OData CSDL XML
  // <EntitySet Name="Customer" EntityType="..." /> — grab the Name attribute
  const entityNames: string[] = []
  const entitySetRe = /<EntitySet\s[^>]*Name="([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = entitySetRe.exec(metadataXml)) !== null) {
    entityNames.push(m[1])
  }

  if (entityNames.length === 0) {
    return NextResponse.json({ error: 'No entities found in BC metadata. Check that OData web services are enabled.' }, { status: 422 })
  }

  // Preserve existing enabled/disabled state; newly discovered entities default to enabled
  const existingConfig: Record<string, boolean> = (tenant.entityConfig as any) ?? {}
  const entityConfig: Record<string, boolean> = {}
  for (const name of entityNames) {
    entityConfig[name] = existingConfig[name] ?? true
  }

  // Persist to DB
  await (prisma as any).tenant.update({ where: { id: tenantId }, data: { entityConfig } })

  return NextResponse.json({
    ok: true, entityConfig,
    discovered: entityNames.length,
    enabled: Object.values(entityConfig).filter(Boolean).length,
  })
}
