/**
 * POST /api/requirements/[id]/submit-for-review
 *
 * Submits a draft requirement for senior developer review.
 * - Superadmin: bypasses fee, submits directly.
 * - Manager/Executive with monthly allowance remaining: submits via allowance.
 * - All others: creates a Stripe Checkout for $249 NZD + GST (15%) + optional surcharge.
 *
 * The requirement must have an AI spec generated before submission.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { stripe }                    from '@/lib/stripe'
import { prisma }                    from '@/lib/db'
import { getReviewAllowance }        from '@/lib/tier'
import { calcSurcharge, surchargeDescription, isInternationalCountry } from '@/lib/stripe-fees'
import { GST_RATE }                  from '@/lib/business-config'

export const dynamic = 'force-dynamic'

const REVIEW_FEE_NZD = 249

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const requirementId = params.id

  const requirement = await (prisma as any).requirement.findUnique({
    where:   { id: requirementId },
    include: {
      user:   { select: { name: true, email: true } },
      tenant: { select: { name: true, country: true, stripeCustomerId: true } },
    },
  })

  if (!requirement) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (user.role !== 'superadmin' && requirement.tenantId !== user.tenantId)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (requirement.status !== 'draft')
    return NextResponse.json({ error: 'Requirement is not in draft status' }, { status: 400 })
  if (!requirement.aiSpec)
    return NextResponse.json({ error: 'Please generate a specification before submitting for review' }, { status: 400 })

  const now = new Date()

  // ── Superadmin bypass ────────────────────────────────────────────────────
  if (user.role === 'superadmin') {
    const updated = await (prisma as any).requirement.update({
      where: { id: requirementId },
      data:  { status: 'submitted', reviewBypassed: true, reviewSubmittedAt: now },
      include: { user: { select: { name: true, email: true } }, tenant: { select: { name: true } } },
    })
    return NextResponse.json({ submitted: true, requirement: updated })
  }

  // ── Already covered ───────────────────────────────────────────────────────
  if (requirement.reviewPaidAt || requirement.reviewBypassed || requirement.reviewIncluded) {
    const updated = await (prisma as any).requirement.update({
      where: { id: requirementId },
      data:  { status: 'submitted', reviewSubmittedAt: now },
      include: { user: { select: { name: true, email: true } }, tenant: { select: { name: true } } },
    })
    return NextResponse.json({ submitted: true, requirement: updated })
  }

  const tenantId = user.tenantId

  // ── Monthly tier allowance ────────────────────────────────────────────────
  const allowance = await getReviewAllowance(tenantId)
  if (allowance.remaining > 0) {
    const updated = await (prisma as any).requirement.update({
      where: { id: requirementId },
      data:  { status: 'submitted', reviewIncluded: true, reviewSubmittedAt: now },
      include: { user: { select: { name: true, email: true } }, tenant: { select: { name: true } } },
    })
    return NextResponse.json({ submitted: true, requirement: updated })
  }

  // ── Stripe Checkout: $249 + GST + surcharge ───────────────────────────────
  const isIntl          = isInternationalCountry(requirement.tenant?.country)
  const feeWithGst      = Math.round(REVIEW_FEE_NZD * (1 + GST_RATE) * 100) / 100
  const surchargeFees   = calcSurcharge(feeWithGst, isIntl)

  let customerId = requirement.tenant?.stripeCustomerId as string | null
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email, name: requirement.tenant?.name ?? '',
      metadata: { tenantId },
    })
    customerId = customer.id
    await (prisma as any).tenant.update({ where: { id: tenantId }, data: { stripeCustomerId: customerId } })
  }

  const origin = req.headers.get('origin') ?? 'https://bespoxai.com'

  const checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId,
    mode:     'payment',
    line_items: [
      {
        price_data: {
          currency:     'nzd',
          product_data: {
            name:        'Specification Review — Senior BC Developer',
            description: `Review of: ${requirement.title}. This fee is credited in full against development costs if you proceed.`,
          },
          unit_amount: Math.round(REVIEW_FEE_NZD * 100),
        },
        quantity: 1,
      },
      {
        price_data: {
          currency:     'nzd',
          product_data: { name: 'GST (15%)' },
          unit_amount:  Math.round(REVIEW_FEE_NZD * GST_RATE * 100),
        },
        quantity: 1,
      },
      {
        price_data: {
          currency:     'nzd',
          product_data: { name: surchargeDescription(isIntl) },
          unit_amount:  Math.round(surchargeFees.surcharge * 100),
        },
        quantity: 1,
      },
    ],
    success_url: `${origin}/dashboard?view=customisations&review=paid`,
    cancel_url:  `${origin}/dashboard?view=customisations`,
    metadata: { paymentType: 'spec_review', requirementId, tenantId },
  })

  return NextResponse.json({
    checkoutUrl:  checkoutSession.url,
    feeBase:      REVIEW_FEE_NZD,
    feeWithGst,
    surcharge:    surchargeFees.surcharge,
    totalCharged: surchargeFees.totalCharged,
    isIntl,
  })
}
