/**
 * GET /api/ai-usage
 *
 * Returns the current tenant's AI token usage and limit for this month.
 * Used by the dashboard to show the usage meter.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { checkTokenLimit } from '@/lib/tier'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenantId = (session.user as any).tenantId
  if (!tenantId) return NextResponse.json({ error: 'No tenant' }, { status: 400 })

  const status = await checkTokenLimit(tenantId)
  return NextResponse.json(status)
}
