import { NextRequest, NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/api-auth'
import { getTenantById } from '@/lib/tenants'

export const dynamic = 'force-dynamic'

// GET /api/bc-test?entity=Customer
// Tests a BC OData entity and returns raw response or error
export async function GET(req: NextRequest) {
  // Raw OData access bypasses the entity toggles, so it's for tenant admins only
  const session = await requireTenantAdmin()
  if (session instanceof NextResponse) return session

  const tenant = await getTenantById((session.user as any).tenantId)
  if (!tenant) return NextResponse.json({ error: 'No tenant' }, { status: 404 })

  const { searchParams } = new URL(req.url)
  const entity = searchParams.get('entity') ?? '$metadata'
  const top = Math.max(1, Math.min(50, parseInt(searchParams.get('top') ?? '2', 10) || 2))
  // An entity name only — no path segments, so the request can't be steered
  // to other BCAgent endpoints (e.g. '../../bespoxai/...')
  if (entity !== '$metadata' && !/^[A-Za-z0-9_]+$/.test(entity))
    return NextResponse.json({ error: 'Invalid entity name' }, { status: 400 })

  const url = entity === '$metadata'
    ? `${tenant.agentBaseUrl}/${tenant.bcInstance}/ODataV4/$metadata`
    : `${tenant.agentBaseUrl}/${tenant.bcInstance}/ODataV4/Company('${tenant.bcCompany}')/${entity}?$top=${top}`

  try {
    const res = await fetch(url, {
      headers: { 'X-BespoxAI-Key': tenant.apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })

    const text = await res.text()
    let parsed: any = null
    try { parsed = JSON.parse(text) } catch {}

    return NextResponse.json({
      status: res.status,
      ok: res.ok,
      url,
      entity,
      response: parsed ?? text.slice(0, 2000),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message, url }, { status: 500 })
  }
}
