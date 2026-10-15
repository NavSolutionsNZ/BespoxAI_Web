/**
 * /api/admin/tenants/[id]/object-exports — BCAgent full object exports (superadmin).
 *   GET  → recent jobs, licence state, tenant time zone
 *   POST → schedule: { notBefore: ISO, confirmInHours?: boolean }
 *          409 { needsConfirm } when the time is inside business hours.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/api-auth'
import { listExports, scheduleExport } from '@/lib/export-job-routes'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const auth = await requireSuperadmin()
  if (auth instanceof NextResponse) return auth
  return listExports(id)
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const auth = await requireSuperadmin()
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => ({})) as { notBefore?: string; confirmInHours?: boolean }
  return scheduleExport({ tenantId: id, userId: (auth.user as any).id, notBefore: body.notBefore, confirmInHours: !!body.confirmInHours })
}
