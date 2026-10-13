import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { DEFAULT_CFO_PACK } from '@/lib/dashboards/default-pack'
import { BC_SERVICES } from '@/lib/dashboards/bc-services'
import DashboardRenderer from '@/components/dashboards/DashboardRenderer'

export const dynamic = 'force-dynamic'

/**
 * Superadmin preview of the default CFO dashboard.
 *   /admin/dashboards                         → mock data
 *   /admin/dashboards?source=live&tenantId=X  → that tenant's NAV via the agent
 * The live mode is how the FlowFilter field names get verified against a real NAV.
 */
export default async function DashboardsPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await getServerSession(authOptions)
  if ((session?.user as any)?.role !== 'superadmin') redirect('/dashboard')

  const sp = await searchParams
  const live = sp.source === 'live' && !!sp.tenantId
  const services = Object.values(BC_SERVICES)
  const unverified = services.filter(s => !s.verified)

  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 16px 64px', background: 'var(--parchment)', minHeight: '100vh' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--slate)', marginBottom: 6 }}>
        {live ? 'Live preview · tenant ' + sp.tenantId : 'Preview · mock data'}
      </div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 34, margin: '0 0 8px', color: 'var(--ink)' }}>
        {DEFAULT_CFO_PACK.name}
      </h1>
      {unverified.length > 0 ? (
        <p style={{ fontSize: 13, color: 'var(--slate)', margin: '0 0 24px', maxWidth: 760 }}>
          {unverified.length + ' of ' + services.length + ' NAV web services are not yet verified, so live dashboards stay superadmin-only. Pages: ' + unverified.map(s => s.pageName + ' (' + s.pageId + ')').join(', ') + '.'}
        </p>
      ) : null}
      <DashboardRenderer spec={DEFAULT_CFO_PACK} source={live ? 'live' : 'mock'} tenantId={live ? sp.tenantId : undefined} />
    </main>
  )
}
