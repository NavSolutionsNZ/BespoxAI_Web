/**
 * /api/partner/tenants/[id]/object-exports — BCAgent full object exports for a partner's tenant.
 *   GET  → any user of the managing partner
 *   POST → partner admins only (the export runs under the partner's developer licence)
 *          body { notBefore: ISO, confirmInHours?: boolean }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerSession, assertTenantBelongsToPartner } from '@/lib/partner-auth'
import { listExports, scheduleExport } from '@/lib/export-job-routes'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const FORBIDDEN = () => NextResponse.json({ error: 'Forbidden' }, { status: 403 })

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const ps = await requirePartnerSession()
  if (!ps) return FORBIDDEN()
  try { await assertTenantBelongsToPartner(id, ps.partnerAccountId) } catch { return FORBIDDEN() }
  return listExports(id)
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const ps = await requirePartnerSession('partner_admin')
  if (!ps) return NextResponse.json({ error: 'Only partner admins can schedule an export — it uses your developer licence.' }, { status: 403 })
  try { await assertTenantBelongsToPartner(id, ps.partnerAccountId) } catch { return FORBIDDEN() }
  const body = await req.json().catch(() => ({})) as { notBefore?: string; confirmInHours?: boolean }
  return scheduleExport({ tenantId: id, userId: ps.userId, notBefore: body.notBefore, confirmInHours: !!body.confirmInHours })
}
