import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getTenantById, buildODataUrl } from '@/lib/tenants'
import { checkFeatureAccess, checkTierAccess } from '@/lib/tier'
import { METRICS } from '@/lib/dashboards/registry'
import { BC_SERVICES } from '@/lib/dashboards/bc-services'
import { fetchMetric, tenantToday } from '@/lib/dashboards/executor'
import { mockSource } from '@/lib/dashboards/sources/mock'
import { agentFetcher, createFlowFilterSource } from '@/lib/dashboards/sources/flowfilter'
import { MetricSourceError } from '@/lib/dashboards/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST { metricId, params?, source?: 'mock' | 'live', tenantId? }
 *
 * - source 'mock': superadmin only (dashboard preview).
 * - source 'live' (default): reads the tenant's NAV through the BespoxAI Agent.
 *   Until every BC_SERVICES entry is verified against a real NAV, live reads
 *   are superadmin-only, and a superadmin may name any tenantId to test against.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const isSuperadmin = user.role === 'superadmin'

  const body = await req.json().catch(() => ({}))
  const metricId = String(body?.metricId ?? '')
  if (!METRICS[metricId]) return NextResponse.json({ error: 'Unknown metric' }, { status: 400 })
  const source = body?.source === 'mock' ? 'mock' : 'live'

  try {
    if (source === 'mock') {
      if (!isSuperadmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      const result = await fetchMetric(mockSource, metricId, body.params, { today: tenantToday('NZ') })
      return NextResponse.json({ result })
    }

    const allVerified = Object.values(BC_SERVICES).every(s => s.verified)
    if (!allVerified && !isSuperadmin) {
      return NextResponse.json({ error: 'not_ready', message: 'Live dashboards are not enabled yet.' }, { status: 409 })
    }

    const tenantId: string | undefined = isSuperadmin && typeof body.tenantId === 'string' && body.tenantId
      ? body.tenantId
      : user.tenantId
    if (!tenantId) return NextResponse.json({ error: 'No tenant' }, { status: 400 })

    if (!isSuperadmin) {
      const tier = await checkTierAccess(tenantId)
      if (!tier.allowed) return NextResponse.json({ error: 'tier_blocked' }, { status: 402 })
      if (!(await checkFeatureAccess(tenantId, 'assistant'))) {
        return NextResponse.json({ error: 'upgrade_required' }, { status: 402 })
      }
    }

    const tenant = await getTenantById(tenantId)
    if (!tenant) return NextResponse.json({ error: 'Tenant not configured' }, { status: 404 })

    const src = createFlowFilterSource(tenant, { fetcher: agentFetcher(tenant), buildUrl: buildODataUrl })
    const result = await fetchMetric(src, metricId, body.params, { today: tenantToday(tenant.country) })
    return NextResponse.json({ result })
  } catch (e: any) {
    if (e instanceof MetricSourceError) {
      return NextResponse.json({ error: e.code, message: e.message, detail: isSuperadmin ? e.detail : undefined }, { status: 502 })
    }
    return NextResponse.json({ error: 'metric_failed', message: e?.message ?? 'Failed' }, { status: 400 })
  }
}
