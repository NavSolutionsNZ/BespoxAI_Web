/**
 * POST /api/requirements/[id]/pay-balance
 *
 * Creates a Stripe Checkout session for the 80% balance payment on completion.
 * Accepts { withSurcharge: boolean } — same surcharge logic as pay-deposit.
 * Webhook sets balancePaidAt and status → fully_paid on success.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { stripe } from '@/lib/stripe'
import { prisma } from '@/lib/db'
import { calcSurcharge, surchargeDescription, isInternationalCountry } from '@/lib/stripe-fees'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user          = session.user as any
  const requirementId = params.id
  const body          = await req.json().catch(() => ({}))
  const withSurcharge = body.withSurcharge === true

  const requirement = await (prisma as any).requirement.findUnique({
    where:   { id: requirementId },
    include: {
      user:   { select: { name: true, email: true } },
      tenant: { select: { name: true, country: true, stripeCustomerId: true } },
    },
  })

  if (!requirement)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (user.role !== 'superadmin' && requirement.tenantId !== user.tenantId)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (requirement.status !== 'complete_pending_payment')
    return NextResponse.json({ error: 'Requirement is not awaiting balance payment' }, { status: 400 })
  if (!requirement.quote)
    return NextResponse.json({ error: 'No quote amount set' }, { status: 400 })

  const quoteAmount  = parseFloat(requirement.quote.toString())
  const depositPaid  = parseFloat(requirement.depositAmount?.toString() ?? '0')
  const balanceBase  = Math.round((quoteAmount - depositPaid) * 100) / 100
  const isIntl       = isInternationalCountry(requirement.tenant?.country)
  const fees         = calcSurcharge(balanceBase, isIntl)

  // Ensure Stripe customer record
  let customerId = requirement.tenant?.stripeCustomerId as string | null
  if (!customerId) {
    const customer = await stripe.customers.create({
      email:    user.email,
      name:     requirement.tenant?.name ?? '',
      metadata: { tenantId: user.tenantId },
    })
    customerId = customer.id
    await (prisma as any).tenant.update({
      where: { id: user.tenantId },
      data:  { stripeCustomerId: customerId },
    })
  }

  const origin = req.headers.get('origin') ?? 'https://bespoxai.com'

  const lineItems: any[] = [
    {
      price_data: {
        currency:     'nzd',
        product_data: {
          name:        `Development Balance — ${requirement.title}`,
          description: `80% balance payment on $${quoteAmount.toLocaleString('en-NZ', { minimumFractionDigits: 2 })} NZD quote. Delivery follows payment confirmation.`,
        },
        unit_amount: Math.round(balanceBase * 100),
      },
      quantity: 1,
    },
  ]

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
    customer:    customerId,
    mode:        'payment',
    line_items:  lineItems,
    success_url: `${origin}/dashboard?view=customisations&balance=paid`,
    cancel_url:  `${origin}/dashboard?view=customisations`,
    metadata: {
      paymentType:   'requirement_balance',
      requirementId,
      tenantId:      user.tenantId,
    },
  })

  return NextResponse.json({
    checkoutUrl:  checkoutSession.url,
    balanceBase,
    surcharge:    fees.surcharge,
    totalCharged: fees.totalCharged,
    isIntl,
  })
}
