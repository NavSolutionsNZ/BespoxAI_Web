/**
 * GET /api/ai-usage
 *
 * Returns the current tenant's AI token usage and limit for this month.
 * Used by the dashboard to show the usage meter.
 * Response cached for 60s per tenant.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { checkTokenLimit } from '@/lib/tier'
import { unstable_cache } from 'next/cache'

export const dynamic = 'force-dynamic'

const getCachedTokenStatus = unstable_cache(
  async (tenantId: string) => {
    return await checkTokenLimit(tenantId)
  },
  ['ai-usage'],
  { revalidate: 60 }
)

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenantId = (session.user as any).tenantId
  if (!tenantId) return NextResponse.json({ error: 'No tenant' }, { status: 400 })

  try {
    const status = await getCachedTokenStatus(tenantId)
    return NextResponse.json(status)
  } catch (error) {
    console.error('[ai-usage] Error:', error)
    return NextResponse.json({ error: 'Failed to check token limit' }, { status: 500 })
  }
}
