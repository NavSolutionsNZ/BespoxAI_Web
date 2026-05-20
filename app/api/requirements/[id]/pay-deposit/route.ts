/**
 * POST /api/requirements/[id]/pay-deposit
 *
 * Handles deposit payment on quote acceptance.
 * - Terms 1/2: Stripe checkout (with optional surcharge) or bank transfer invoice flag
 * - Terms 3:   Auto-advances to deposit_paid (no payment required)
 * GST (15%) is added to all Stripe charges. Merchant receives the base amount.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { stripe }                    from '@/lib/stripe'
import { prisma }                    from '@/lib/db'
import { calcSurcharge, surchargeDescription, isInternationalCountry } from '@/lib/stripe-fees'
import { requiresDeposit, GST_RATE } from '@/lib/business-config'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user          = session.user as any
  const requirementId = params.id
  const body          = await req.json().catch(() => ({}))
  const withSurcharge = body.withSurcharge === true

  const requirement = await (prisma as any).requirement.findUnique({
    where:   { id: requirementId },
    include: { tenant: { select: { name: true, country: true, stripeCustomerId: true, paymentTermsKey: true } } },
  })

  if (!requirement)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (user.role !== 'superadmin' && requirement.tenantId !== user.tenantId)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (requirement.status !== 'quoted' && requirement.status !== 'deposit_required')
    return NextResponse.json({ error: 'Requirement is not awaiting deposit payment' }, { status: 400 })
  if (!requirement.quote)
    return NextResponse.json({ error: 'No quote amount set' }, { status: 400 })

  const termsKey    = requirement.tenant?.paymentTermsKey ?? 'terms1'
  const quoteAmount = parseFloat(requirement.quote.toString())
  const reviewCredit = requirement.reviewPaidAt ? 249 : 0
  const depositBase = Math.max(0, Math.round((quoteAmount * 0.2 - reviewCredit) * 100) / 100)

  // ── Terms 3: no deposit required — auto-advance ───────────────────────────
  if (!requiresDeposit(termsKey)) {
    await (prisma as any).requirement.update({
      where: { id: requirementId },
      data: {
        quoteApprovedAt: new Date(),
        depositAmount:   '0.00',
        depositPaidAt:   new Date(),
        depositBypassed: true,
        status:          'deposit_paid',
      },
    })
    return NextResponse.json({ autoAdvanced: true, termsKey })
  }

  // ── Terms 1/2: Stripe checkout ────────────────────────────────────────────
  const isIntl    = isInternationalCountry(requirement.tenant?.country)
  const depositWithGst = Math.round(depositBase * (1 + GST_RATE) * 100) / 100
  const fees      = calcSurcharge(depositWithGst, isIntl)

  // Record quote acceptance if not already done
  if (requirement.status === 'quoted') {
    await (prisma as any).requirement.update({
      where: { id: requirementId },
      data: { quoteApprovedAt: new Date(), depositAmount: depositBase.toFixed(2) },
    })
  }

  // Ensure Stripe customer record
  let customerId = requirement.tenant?.stripeCustomerId as string | null
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email, name: requirement.tenant?.name ?? '',
      metadata: { tenantId: user.tenantId },
    })
    customerId = customer.id
    await (prisma as any).tenant.update({ where: { id: user.tenantId }, data: { stripeCustomerId: customerId } })
  }

  const origin = req.headers.get('origin') ?? 'https://bespoxai.com'
  const lineItems: any[] = [{
    price_data: {
      currency:     'nzd',
      product_data: { name: `Development Deposit — ${requirement.title}`, description: `20% deposit incl. GST on $${quoteAmount.toLocaleString('en-NZ', { minimumFractionDigits: 2 })} NZD quote.` },
      unit_amount:  Math.round(depositWithGst * 100),
    },
    quantity: 1,
  }]

  if (withSurcharge) {
    lineItems.push({
      price_data: {
        currency:     'nzd',
        product_data: { name: surchargeDescription(isIntl) },
        unit_amount:  Math.round(fees.surcharge * 100),
      },
      quantity: 1,
    })
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId, mode: 'payment', line_items: lineItems,
    success_url: `${origin}/dashboard?view=customisations&deposit=paid`,
    cancel_url:  `${origin}/dashboard?view=customisations`,
    metadata: { paymentType: 'requirement_deposit', requirementId, tenantId: user.tenantId },
  })

  return NextResponse.json({
    checkoutUrl: checkoutSession.url,
    depositBase, depositWithGst,
    surcharge: fees.surcharge, totalCharged: fees.totalCharged, isIntl,
  })
}
