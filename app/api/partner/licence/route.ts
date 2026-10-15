/**
 * /api/partner/licence — the signed-in partner's own developer licence.
 * Used for full object exports of that partner's tenants.
 *   GET    → metadata only (any partner user)
 *   POST   → multipart upload: file (.flf), optional expiresAt (partner admins)
 *   DELETE → remove (partner admins)
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerSession } from '@/lib/partner-auth'
import { licenceGet, licencePost, licenceDelete } from '@/lib/licence-routes'

export const dynamic = 'force-dynamic'

const FORBIDDEN = () => NextResponse.json({ error: 'Forbidden' }, { status: 403 })

export async function GET() {
  const ps = await requirePartnerSession()
  if (!ps) return FORBIDDEN()
  return licenceGet(ps.partnerAccountId)
}

export async function POST(req: NextRequest) {
  const ps = await requirePartnerSession('partner_admin')
  if (!ps) return FORBIDDEN()
  return licencePost(req, ps.partnerAccountId, ps.userId)
}

export async function DELETE() {
  const ps = await requirePartnerSession('partner_admin')
  if (!ps) return FORBIDDEN()
  return licenceDelete(ps.partnerAccountId)
}
