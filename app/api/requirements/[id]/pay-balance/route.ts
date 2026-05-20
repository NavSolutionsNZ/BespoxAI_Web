/**
 * POST /api/requirements/[id]/pay-balance
 *
 * Handles balance payment on completion.
 * - Terms 1:   Stripe checkout (with optional surcharge) or bank transfer
 * - Terms 2/3: Bank transfer only — returns dueDate and bankOnly flag
 * GST (15%) is added to all Stripe charges.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { stripe }                    from '@/lib/stripe'
import { prisma }                    from '@/lib/db'
import { calcSurcharge, surchargeDescription, isInternationalCountry } from '@/lib/stripe-fees'
import { isMonthlyBilling, formatDueDate, GST_RATE } from '@/lib/business-config'

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
  if (requirement.status !== 'complete_pending_payment')
    return NextResponse.json({ error: 'Requirement is not awaiting balance payment' }, { status: 400 })
  if (!requirement.quote)
    return NextResponse.json({ error: 'No quote amount set' }, { status: 400 })

  const termsKey   = requirement.tenant?.paymentTermsKey ?? 'terms1'
  const quoteAmount = parseFloat(requirement.quote.toString())
  const depositPaid = parseFloat(requirement.depositAmount?.toString() ?? '0')
  const balanceBase = Math.round((quoteAmount - depositPaid) * 100) / 100
  const dueDate     = formatDueDate()

  // ── Terms 2/3: bank transfer only ─────────────────────────────────────────
  if (isMonthlyBilling(termsKey)) {
    return NextResponse.json({ bankOnly: true, balanceBase, dueDate, termsKey })
  }

  // ── Terms 1: Stripe checkout ──────────────────────────────────────────────
  const isIntl         = isInternationalCountry(requirement.tenant?.country)
  const balanceWithGst = Math.round(balanceBase * (1 + GST_RATE) * 100) / 100
  const fees           = calcSurcharge(balanceWithGst, isIntl)

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
      product_data: { name: `Development Balance — ${requirement.title}`, description: `Balance payment incl. GST. Delivery follows confirmation.` },
      unit_amount:  Math.round(balanceWithGst * 100),
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
    success_url: `${origin}/dashboard?view=customisations&balance=paid`,
    cancel_url:  `${origin}/dashboard?view=customisations`,
    metadata: { paymentType: 'requirement_balance', requirementId, tenantId: user.tenantId },
  })

  return NextResponse.json({
    checkoutUrl: checkoutSession.url,
    balanceBase, balanceWithGst,
    surcharge: fees.surcharge, totalCharged: fees.totalCharged, isIntl,
  })
}
