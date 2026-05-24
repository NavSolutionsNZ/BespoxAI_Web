import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

function isTenantAdmin(role: string) { return role === 'tenant_admin' || role === 'superadmin' }

// POST /api/settings/sync-config
// Reads the tenant's current settings from DB and pushes them to the live BCAgent.
// Only non-credential fields are synced (bcPassword stays unchanged on the agent).
export async function POST() {
  const session = await getServerSession(authOptions)
  const role = (session?.user as any)?.role
  if (!session?.user || !isTenantAdmin(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const tenantId = (session.user as any).tenantId
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  if (!tenant.tunnelSubdomain) return NextResponse.json({ error: 'No tunnel configured — download the installer first' }, { status: 400 })

  const agentUrl = 'https://' + tenant.tunnelSubdomain + '-agent.bespoxai.com'
  const bcPort     = tenant.bcPort     || 8048
  const agentPort  = tenant.agentPort  || 9099
  const bcInstance = tenant.bcInstance || 'BC'
  const bcCompany  = tenant.bcCompany  || ''

  const payload: Record<string, any> = {
    bcBaseUrl:            'http://localhost:' + bcPort + '/' + bcInstance,
    bcInstance:           bcInstance,
    bcCompany:            bcCompany,
    bcPort:               bcPort,
    agentPort:            agentPort,
    navDatabaseServer:    tenant.navDatabaseServer    || 'localhost',
    navDatabaseName:      tenant.navDatabaseName      || '',
    navServerInstance:    tenant.navServerInstance    || '',
    testNavDatabaseServer: tenant.testNavDatabaseServer || '',
    testNavDatabaseName:   tenant.testNavDatabaseName   || '',
    testNavServerInstance: tenant.testNavServerInstance || '',
    testBcInstance:        tenant.testBcInstance        || '',
    testBcCompany:         tenant.testBcCompany         || '',
    testBcPort:            tenant.testBcPort            || 0,
    testNavManagementPort: (tenant as any).testNavManagementPort || 7045,
  }

  let agentRes: Response
  try {
    agentRes = await fetch(agentUrl + '/bespoxai/update-config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-BespoxAI-Key': tenant.apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    })
  } catch (e: any) {
    return NextResponse.json({ error: 'Could not reach agent: ' + e.message }, { status: 502 })
  }

  const text = await agentRes.text()
  let json: any = {}
  try { json = JSON.parse(text) } catch { json = { raw: text.slice(0, 200) } }

  if (!agentRes.ok) {
    return NextResponse.json(
      { error: json.error || ('Agent returned ' + agentRes.status) },
      { status: 502 }
    )
  }

  return NextResponse.json({ success: true })
}
