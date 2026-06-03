import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerSession, assertTenantBelongsToPartner } from '@/lib/partner-auth'
import { prisma } from '@/lib/db'
import {
  notifyAdminsNewRequirement,
  notifyAdminsAnswered,
  notifyAdminsQuoteRejected,
} from '@/lib/notifications'

export const dynamic = 'force-dynamic'

function readQALog(raw: string | null): any[] {
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

const REQ_INCLUDE = {
  user:   { select: { name: true, email: true } },
  tenant: { select: { name: true, country: true, paymentTermsKey: true } },
  addenda: {
    orderBy: { createdAt: 'asc' as const },
    select:  { id: true, title: true, status: true, quote: true, createdAt: true, parentId: true },
  },
}

// GET /api/partner/tenants/[id]/requirements/[reqId]
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

  const req = await (prisma as any).requirement.findFirst({
    where:   { id: params.reqId, tenantId: params.id },
    include: REQ_INCLUDE,
  })
  if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { devPlan, ...rest } = req
  return NextResponse.json({ requirement: rest })
}

// PATCH /api/partner/tenants/[id]/requirements/[reqId]
// Partners act on behalf of the tenant — same customer-side actions
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; reqId: string } }
) {
  const session = await requirePartnerSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await assertTenantBelongsToPartner(params.id, session.partnerAccountId)
  } catch {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const existing = await (prisma as any).requirement.findFirst({
    where: { id: params.reqId, tenantId: params.id },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const { status, title, description, bcArea, priority, customerAnswers, quoteRejectionReason } = body
  const updateData: any = {}

  // Submit
  if (status === 'submitted' && ['draft', 'needs_clarification', 'quote_rejected'].includes(existing.status)) {
    updateData.status = 'submitted'
    if (!existing.submittedAt) updateData.submittedAt = new Date()

    if (existing.status === 'needs_clarification' && customerAnswers) {
      updateData.customerAnswers = customerAnswers
      const log = readQALog(existing.adminQALog)
      const lastOpen = [...log].reverse().find((r: any) => r.answers === null)
      if (lastOpen) {
        lastOpen.answers    = customerAnswers
        lastOpen.answeredAt = new Date().toISOString()
        updateData.adminQALog = JSON.stringify(log)
      }
    }
  }

  // Approve quote → deposit_required
  if (status === 'deposit_required' && existing.status === 'quoted') {
    updateData.status           = 'deposit_required'
    updateData.quoteApprovedAt  = new Date()
    updateData.depositRequiredAt = new Date()
    if (existing.quote) {
      updateData.depositAmount = parseFloat(existing.quote.toString()) * 0.2
    }
    if (body.poNumber !== undefined) updateData.poNumber = body.poNumber || null
  }

  // Reject quote
  if (status === 'quote_rejected' && existing.status === 'quoted') {
    updateData.status               = 'quote_rejected'
    updateData.quoteRejectedAt      = new Date()
    updateData.quoteRejectionReason = quoteRejectionReason ?? ''
  }

  // Edit while in editable states
  if (['draft', 'needs_clarification', 'quote_rejected'].includes(existing.status)) {
    if (title !== undefined)           updateData.title           = title.trim()
    if (description !== undefined)     updateData.description     = description.trim()
    if (bcArea !== undefined)          updateData.bcArea          = bcArea
    if (priority !== undefined)        updateData.priority        = priority
    if (customerAnswers !== undefined) updateData.customerAnswers = customerAnswers
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: 'No valid updates' }, { status: 400 })
  }

  const updated = await (prisma as any).requirement.update({
    where:   { id: params.reqId },
    data:    updateData,
    include: REQ_INCLUDE,
  })

  // Notifications
  const tenantName   = updated.tenant?.name ?? ''
  const reqTitle     = updated.title
  const partnerEmail = '' // partner users don't have a tenant email — use admin notifications only

  if (updateData.status === 'submitted' && existing.status === 'needs_clarification') {
    notifyAdminsAnswered({ requirementId: params.reqId, title: reqTitle, tenantName, customerName: 'Partner' }).catch(() => {})
  }
  if (updateData.status === 'submitted' && existing.status === 'draft') {
    notifyAdminsNewRequirement({ requirementId: params.reqId, title: reqTitle, tenantName, customerName: 'Partner', customerEmail: partnerEmail, isAddendum: !!existing.parentId }).catch(() => {})
  }
  if (updateData.status === 'quote_rejected') {
    notifyAdminsQuoteRejected({ title: reqTitle, tenantName, customerName: 'Partner', rejectionReason: updateData.quoteRejectionReason }).catch(() => {})
  }

  const { devPlan, ...rest } = updated
  return NextResponse.json({ requirement: rest })
}
