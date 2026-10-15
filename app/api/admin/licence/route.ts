/**
 * /api/admin/licence — Nav Solutions Limited's developer licence (superadmin).
 * Used for full object exports of tenants with no managing partner.
 *   GET    → metadata only (never the file)
 *   POST   → multipart upload: file (.flf), optional expiresAt
 *   DELETE → remove
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/api-auth'
import { licenceGet, licencePost, licenceDelete } from '@/lib/licence-routes'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireSuperadmin()
  if (auth instanceof NextResponse) return auth
  return licenceGet(null)
}

export async function POST(req: NextRequest) {
  const auth = await requireSuperadmin()
  if (auth instanceof NextResponse) return auth
  return licencePost(req, null, (auth.user as any).id)
}

export async function DELETE() {
  const auth = await requireSuperadmin()
  if (auth instanceof NextResponse) return auth
  return licenceDelete(null)
}
