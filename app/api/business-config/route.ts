/**
 * GET /api/business-config
 * Returns the business config needed for client-side invoice PDF generation.
 * Authenticated users only. Includes bank details (needed for bank transfer invoices).
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getBusinessConfig } from '@/lib/business-config'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await getBusinessConfig())
}
