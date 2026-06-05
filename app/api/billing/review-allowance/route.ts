/**
 * GET /api/billing/review-allowance
 * Returns the current tenant's monthly senior review allowance status.
 * Used by RequirementsBuilder to label the submit button.
 * 
 * Response cached for 60s per tenant to avoid repeated database lookups.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getReviewAllowance } from '@/lib/tier'
import { unstable_cache } from 'next/cache'

export const dynamic = 'force-dynamic'

const getCachedAllowance = unstable_cache(
  async (tenantId: string) => {
    return await getReviewAllowance(tenantId)
  },
  ['review-allowance'],
  { revalidate: 60 }
)

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const tenantId = user.tenantId

  if (!tenantId) return NextResponse.json({ included: 0, used: 0, remaining: 0 })

  try {
    const allowance = await getCachedAllowance(tenantId)
    return NextResponse.json(allowance)
  } catch (error) {
    console.error('[review-allowance] Error:', error)
    return NextResponse.json({ included: 0, used: 0, remaining: 0 })
  }
}
