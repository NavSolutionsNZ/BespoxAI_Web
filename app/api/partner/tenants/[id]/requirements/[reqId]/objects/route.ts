/**
 * GET /api/partner/tenants/[id]/requirements/[reqId]/objects
 *
 * Partner-deliverer equivalent of the direct GET /api/requirements/[id]/objects.
 * Returns the parsed object-file records for this requirement (no content body —
 * just metadata + hasContent), so the partner deploy panel can collect the
 * fileIds with content to pass to the write step.
 *
 * Auth: requirePartnerSession + assertTenantBelongsToPartner + assertPartnerCanDevelop.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  requirePartnerSession,
  assertTenantBelongsToPartner,
  assertPartnerCanDevelop,
} from '@/lib/partner-auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; reqId: string } }
) {
  const session = await requirePartnerSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await assertTenantBelongsToPartner(params.id, session.partnerAccountId)
  } catch {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  try {
    await assertPartnerCanDevelop(session.partnerAccountId)
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Forbidden' }, { status: 403 })
  }

  // Confirm the requirement belongs to this tenant before listing its objects.
  const requirement = await (prisma as any).requirement.findFirst({
    where:  { id: params.reqId, tenantId: params.id },
    select: { id: true },
  })
  if (!requirement)
    return NextResponse.json({ error: 'Requirement not found' }, { status: 404 })

  const rawObjects = await (prisma as any).tenantObjectFile.findMany({
    where:   { requirementId: params.reqId },
    select:  {
      id: true, filename: true, objectType: true, objectId: true,
      objectName: true, language: true, summary: true, parseError: true,
      uploadedAt: true,
      content: true,
    },
    orderBy: { uploadedAt: 'asc' },
  })

  const objects = (rawObjects as any[]).map(o => ({
    ...o,
    hasContent: !!o.content,
    content: undefined,
  }))

  return NextResponse.json({ objects })
}
