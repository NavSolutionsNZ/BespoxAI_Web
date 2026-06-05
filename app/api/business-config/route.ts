/**
 * GET /api/business-config
 * Returns the business config needed for client-side invoice PDF generation.
 * Authenticated users only. Includes bank details (needed for bank transfer invoices).
 * Response cached globally for 60s (same for all users).
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getBusinessConfig } from '@/lib/business-config'
import { unstable_cache } from 'next/cache'

export const dynamic = 'force-dynamic'

const getCachedBusinessConfig = unstable_cache(
  async () => {
    return await getBusinessConfig()
  },
  ['business-config'],
  { revalidate: 60 }
)

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const config = await getCachedBusinessConfig()
    return NextResponse.json(config)
  } catch (error) {
    console.error('[business-config] Error:', error)
    return NextResponse.json({ error: 'Failed to load business config' }, { status: 500 })
  }
}
