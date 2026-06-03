import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerSession, assertTenantBelongsToPartner } from '@/lib/partner-auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// POST /api/partner/tenants/[id]/sync-config
// Reads the tenant's current settings from DB and pushes them to the live BCAgent.
// Only non-credential fields are synced (bcPassword stays unchanged on the agent).
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await requirePartnerSession('partner_admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await assertTenantBelongsToPartner(params.id, session.partnerAccountId)
  } catch {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const tenant = await (prisma as any).tenant.findUnique({ where: { id: params.id } })
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  if (!tenant.tunnelSubdomain) return NextResponse.json({ error: 'No tunnel configured — download the installer first' }, { status: 400 })

  const agentUrl   = 'https://' + tenant.tunnelSubdomain + '-agent.bespoxai.com'
  const bcPort     = tenant.bcPort     || 8048
  const agentPort  = tenant.agentPort  || 9099
  const bcInstance = tenant.bcInstance || 'BC'
  const bcCompany  = tenant.bcCompany  || ''

  const payload: Record<string, any> = {
    bcBaseUrl:             'http://localhost:' + bcPort + '/' + bcInstance,
    bcInstance,
    bcCompany,
    bcPort,
    agentPort,
    navDatabaseServer:     tenant.navDatabaseServer     || 'localhost',
    navDatabaseName:       tenant.navDatabaseName       || '',
    navServerInstance:     tenant.navServerInstance     || '',
    navManagementPort:     tenant.navManagementPort     || 7045,
    testNavDatabaseServer: tenant.testNavDatabaseServer || '',
    testNavDatabaseName:   tenant.testNavDatabaseName   || '',
    testNavServerInstance: tenant.testNavServerInstance || '',
    testBcInstance:        tenant.testBcInstance        || '',
    testBcCompany:         tenant.testBcCompany         || '',
    testBcPort:            tenant.testBcPort            || 0,
    testNavManagementPort: tenant.testNavManagementPort || 7045,
  }

  let agentRes: Response
  try {
    agentRes = await fetch(agentUrl + '/bespoxai/update-config', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-BespoxAI-Key': tenant.apiKey },
      body:    JSON.stringify(payload),
      signal:  AbortSignal.timeout(15000),
    })
  } catch (e: any) {
    return NextResponse.json({ error: 'Could not reach agent: ' + e.message }, { status: 502 })
  }

  const text = await agentRes.text()
  let json: any = {}
  try { json = JSON.parse(text) } catch { json = { raw: text.slice(0, 200) } }

  if (!agentRes.ok) {
    return NextResponse.json({ error: json.error || ('Agent returned ' + agentRes.status) }, { status: 502 })
  }

  return NextResponse.json({ success: true })
}
