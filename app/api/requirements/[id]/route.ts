import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import {
  notifyAdminsNewRequirement,
  notifyAdminsAnswered,
  notifyAdminsQuoteRejected,
  notifyCustomerNeedsClarif,
  notifyCustomerQuoted,
  notifyCustomerInDevelopment,
  notifyCustomerBalanceDue,
} from '@/lib/notifications'

export const dynamic = 'force-dynamic'

// Helper: read adminQALog as array
function readQALog(raw: string | null): any[] {
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const isSuperadmin = user.role === 'superadmin'
  const body = await req.json()

  const existing = await (prisma as any).requirement.findUnique({ where: { id: params.id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isSuperadmin && existing.tenantId !== user.tenantId)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const updateData: any = {}

  if (isSuperadmin) {
    if (body.status !== undefined)              updateData.status              = body.status
    if (body.quote !== undefined)               updateData.quote               = body.quote !== null ? parseFloat(body.quote) : null
    if (body.consultantNote !== undefined)      updateData.consultantNote      = body.consultantNote
    if (body.assignedDeveloperId !== undefined) updateData.assignedDeveloperId = body.assignedDeveloperId

    // Superadmin can directly patch bcObjects in the aiSpec
    if (body.bcObjects !== undefined && existing.aiSpec) {
      try {
        const spec = JSON.parse(existing.aiSpec)
        spec.bcObjects = body.bcObjects
        updateData.aiSpec = JSON.stringify(spec)
      } catch { /* ignore */ }
    }

    // Send back with questions → needs_clarification
    // Append new round to adminQALog
    if (body.status === 'needs_clarification' && body.adminQuestions) {
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

    // Admin marks deposit paid
    if (body.status === 'deposit_paid') {
      updateData.status = 'deposit_paid'
      updateData.depositPaidAt = new Date()
    }
    // Admin marks balance paid → fully_paid
    if (body.status === 'fully_paid') {
      updateData.status = 'fully_paid'
      updateData.balancePaidAt = new Date()
    }
    if (body.status === 'in_development' && existing.status === 'deposit_paid') {
      updateData.status = 'in_development'
    }
    if (body.status === 'complete_pending_payment' && existing.status === 'in_development') {
      updateData.status = 'complete_pending_payment'
    }

  } else {
    // Customer
    const { status, title, description, bcArea, priority, customerAnswers, quoteRejectionReason } = body

    // Submit: also record customer answers against the open admin Q&A round
    if (status === 'submitted' && ['draft', 'needs_clarification', 'quote_rejected'].includes(existing.status)) {
      updateData.status = 'submitted'

      // If coming from needs_clarification, pair the answer with the open round
      if (existing.status === 'needs_clarification' && customerAnswers) {
        updateData.customerAnswers = customerAnswers
        const log = readQALog(existing.adminQALog)
        // Find last unanswered round and fill it in
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
      updateData.status = 'deposit_required'
      updateData.quoteApprovedAt = new Date()
      if (existing.quote) {
        updateData.depositAmount = parseFloat(existing.quote.toString()) * 0.2
      }
      // Persist PO number from invoice path
      if (body.poNumber !== undefined) updateData.poNumber = body.poNumber || null
    }

    // Reject quote
    if (status === 'quote_rejected' && existing.status === 'quoted') {
      updateData.status = 'quote_rejected'
      updateData.quoteRejectedAt = new Date()
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
  }

  const updated = await (prisma as any).requirement.update({
    where: { id: params.id },
    data: updateData,
    include: {
      user:   { select: { name: true, email: true } },
      tenant: { select: { name: true, country: true, paymentTermsKey: true } },
      addenda: { orderBy: { createdAt: 'asc' }, select: { id: true, title: true, status: true, quote: true, createdAt: true, parentId: true } },
    },
  })

  // ── Fire-and-forget notifications ─────────────────────────────────────────
  const customerName  = updated.user?.name  ?? updated.user?.email ?? 'Customer'
  const customerEmail = updated.user?.email ?? ''
  const tenantName    = updated.tenant?.name ?? ''
  const reqTitle      = updated.title

  if (isSuperadmin) {
    // Admin → customer notifications
    if (updateData.status === 'needs_clarification' && updateData.adminQuestions) {
      notifyCustomerNeedsClarif({ customerEmail, customerName, title: reqTitle, tenantName, questions: updateData.adminQuestions })
    }
    if (updateData.status === 'quoted' && updateData.quote !== undefined) {
      const quoteAmt = typeof updateData.quote === 'number' ? updateData.quote : parseFloat(updateData.quote ?? '0')
      notifyCustomerQuoted({ customerEmail, customerName, title: reqTitle, tenantName, quoteAmount: quoteAmt, consultantNote: updateData.consultantNote })
    }
    if (updateData.status === 'in_development') {
      notifyCustomerInDevelopment({ customerEmail, customerName, title: reqTitle, tenantName })
    }
    if (updateData.status === 'complete_pending_payment') {
      const balance = updated.quote ? parseFloat(updated.quote.toString()) * 0.8 : 0
      notifyCustomerBalanceDue({ customerEmail, customerName, title: reqTitle, tenantName, balanceAmount: balance })
    }
  } else {
    // Customer → admin notifications
    if (updateData.status === 'submitted' && existing.status === 'needs_clarification') {
      notifyAdminsAnswered({ requirementId: params.id, title: reqTitle, tenantName, customerName })
    }
    if (updateData.status === 'submitted' && existing.status === 'draft') {
      notifyAdminsNewRequirement({
        requirementId: params.id,
        title:         reqTitle,
        tenantName,
        customerName,
        customerEmail,
        isAddendum:    !!existing.parentId,
        parentTitle:   existing.parentId ? existing.title : undefined,
      })
    }
    if (updateData.status === 'quote_rejected') {
      notifyAdminsQuoteRejected({ title: reqTitle, tenantName, customerName, rejectionReason: updateData.quoteRejectionReason })
    }
  }

  return NextResponse.json({ requirement: updated })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const isSuperadmin = user.role === 'superadmin'

  const existing = await (prisma as any).requirement.findUnique({ where: { id: params.id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isSuperadmin && (existing.status !== 'draft' || existing.tenantId !== user.tenantId))
    return NextResponse.json({ error: 'Cannot delete a submitted requirement' }, { status: 403 })

  await (prisma as any).requirement.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
