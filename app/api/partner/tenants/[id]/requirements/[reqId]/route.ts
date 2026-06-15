import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerSession, assertTenantBelongsToPartner, getPartnerTier } from '@/lib/partner-auth'
import { prisma } from '@/lib/db'
import {
  notifyPartnerNewRequirement,
  notifyPartnerAnswered,
  notifyPartnerQuoteRejected,
  notifyCustomerNeedsClarif,
  notifyCustomerQuoted,
  notifyCustomerInDevelopment,
  notifyCustomerBalanceDue,
  notifyAdminsDepositPaid,
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

  const tier = await getPartnerTier(session.partnerAccountId)
  if (tier === 'referral') {
    const { devPlan, ...rest } = req
    return NextResponse.json({ requirement: rest })
  }
  return NextResponse.json({ requirement: req })
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

  // ── Deliverer transitions (partner acts as BespoxAI's delivery role) ────────
  // Free-form deliverer fields
  if (body.consultantNote !== undefined) updateData.consultantNote = body.consultantNote
  if (body.quote !== undefined)          updateData.quote          = body.quote !== null ? parseFloat(body.quote) : null
  if (body.bcObjects !== undefined && existing.aiSpec) {
    try {
      const spec = JSON.parse(existing.aiSpec)
      spec.bcObjects = body.bcObjects
      updateData.aiSpec = JSON.stringify(spec)
    } catch { /* ignore */ }
  }

  // Move to in_review
  if (status === 'in_review' && !existing.inReviewAt) {
    updateData.status     = 'in_review'
    updateData.inReviewAt = new Date()
  }
  // Send back with questions → needs_clarification (append QALog round)
  if (status === 'needs_clarification' && body.adminQuestions) {
    updateData.status         = 'needs_clarification'
    updateData.adminQuestions = body.adminQuestions
    const log = readQALog(existing.adminQALog)
    log.push({
      round:      log.length + 1,
      questions:  body.adminQuestions,
      answers:    null,
      askedAt:    new Date().toISOString(),
      answeredAt: null,
    })
    updateData.adminQALog = JSON.stringify(log)
  }
  // Issue quote → quoted
  if (status === 'quoted' && body.quote !== undefined && !existing.quotedAt) {
    updateData.status   = 'quoted'
    updateData.quotedAt = new Date()
  }
  // Mark deposit paid (manual — no Stripe in partner pipeline)
  if (status === 'deposit_paid' && existing.status === 'deposit_required') {
    updateData.status        = 'deposit_paid'
    updateData.depositPaidAt = new Date()
  }
  // Start development
  if (status === 'in_development' && existing.status === 'deposit_paid') {
    updateData.status          = 'in_development'
    updateData.inDevelopmentAt = new Date()
  }
  // Mark work complete → complete_pending_payment
  if (status === 'complete_pending_payment' && existing.status === 'in_development') {
    updateData.status                   = 'complete_pending_payment'
    updateData.completePendingPaymentAt = new Date()
  }
  // Mark balance paid → fully_paid (manual)
  if (status === 'fully_paid' && existing.status === 'complete_pending_payment') {
    updateData.status        = 'fully_paid'
    updateData.balancePaidAt = new Date()
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
  const tenantName    = updated.tenant?.name ?? ''
  const reqTitle      = updated.title
  const customerEmail = updated.user?.email ?? ''
  const customerName  = updated.user?.name ?? 'there'

  // ── Deliverer → client-tenant customer (input-required stages) ──────────────
  if (updateData.status === 'needs_clarification' && updateData.adminQuestions && customerEmail) {
    notifyCustomerNeedsClarif({ tenantId: params.id, customerEmail, customerName, title: reqTitle, tenantName, questions: updateData.adminQuestions }).catch(() => {})
  }
  if (updateData.status === 'quoted' && customerEmail) {
    const quoteAmt = updated.quote ? parseFloat(updated.quote.toString()) : 0
    notifyCustomerQuoted({ tenantId: params.id, customerEmail, customerName, title: reqTitle, tenantName, quoteAmount: quoteAmt, consultantNote: updated.consultantNote ?? undefined }).catch(() => {})
  }
  if (updateData.status === 'complete_pending_payment' && customerEmail) {
    const balance = updated.quote ? parseFloat(updated.quote.toString()) * 0.8 : 0
    notifyCustomerBalanceDue({ tenantId: params.id, customerEmail, customerName, title: reqTitle, tenantName, balanceAmount: balance }).catch(() => {})
  }
  if (updateData.status === 'in_development' && customerEmail) {
    notifyCustomerInDevelopment({ tenantId: params.id, customerEmail, customerName, title: reqTitle, tenantName }).catch(() => {})
  }

  // ── Deliverer → BespoxAI superadmins (billing visibility) ───────────────────
  if (updateData.status === 'deposit_paid') {
    const depositAmt = updated.depositAmount ? parseFloat(updated.depositAmount.toString()) : 0
    notifyAdminsDepositPaid({ title: reqTitle, tenantName, customerName: tenantName, depositAmount: depositAmt }).catch(() => {})
  }

  // ── Partner-side (deliverer alerts for customer-driven events) ──────────────
  if (updateData.status === 'submitted' && existing.status === 'needs_clarification') {
    notifyPartnerAnswered({ tenantId: params.id, requirementId: params.reqId, title: reqTitle, tenantName, customerName: 'Partner' }).catch(() => {})
  }
  if (updateData.status === 'submitted' && existing.status === 'draft') {
    notifyPartnerNewRequirement({ tenantId: params.id, requirementId: params.reqId, title: reqTitle, tenantName, customerName: 'Partner', isAddendum: !!existing.parentId }).catch(() => {})
  }
  if (updateData.status === 'quote_rejected') {
    notifyPartnerQuoteRejected({ tenantId: params.id, title: reqTitle, tenantName, customerName: 'Partner', rejectionReason: updateData.quoteRejectionReason }).catch(() => {})
  }

  const tier = await getPartnerTier(session.partnerAccountId)
  if (tier === 'referral') {
    const { devPlan, ...rest } = updated
    return NextResponse.json({ requirement: rest })
  }
  return NextResponse.json({ requirement: updated })
}
