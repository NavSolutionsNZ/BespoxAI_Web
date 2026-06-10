import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerSession } from '@/lib/partner-auth'
import { stripe } from '@/lib/stripe'
import { prisma } from '@/lib/db'
import { getPartnerPlanByPriceId } from '@/lib/partner-plans'

export const dynamic = 'force-dynamic'

/**
 * POST /api/partner/billing/create-checkout
 * Creates or updates partner subscription for upgrading to branded plan
 */
export async function POST(req: NextRequest) {
  const session = await requirePartnerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { priceId } = body
  if (!priceId) return NextResponse.json({ error: 'priceId required' }, { status: 400 })

  // Validate price ID is for a partner plan
  const plan = getPartnerPlanByPriceId(priceId)
  if (!plan) {
    return NextResponse.json({ error: 'Invalid price ID for partner plan' }, { status: 400 })
  }

  const partner = await (prisma as any).partnerAccount.findUnique({
    where: { id: session.partnerAccountId },
  })

  if (!partner) {
    return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
  }

  const existingSubId = partner.stripeSubscriptionId as string | null
  const existingStatus = partner.subscriptionStatus as string | null

  // ── Existing active subscription → update in place (upgrade/downgrade) ──
  if (existingSubId && existingStatus === 'active') {
    const existingSub = await stripe.subscriptions.retrieve(existingSubId)
    const existingItemId = existingSub.items.data[0]?.id
    const existingPriceId = existingSub.items.data[0]?.price?.id

    if (existingPriceId === priceId) {
      return NextResponse.json({ alreadyOnPlan: true })
    }

    // Update the subscription price in place
    await stripe.subscriptions.update(existingSubId, {
      items: [{ id: existingItemId, price: priceId }],
      proration_behavior: 'create_prorations',
    })

    return NextResponse.json({ updated: true })
  }

  // ── No active subscription → create new Stripe Checkout Session ──
  let customerId = partner.stripeCustomerId as string | null

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: partner.billingEmail,
      name: partner.name,
      metadata: { partnerAccountId: session.partnerAccountId },
    })
    customerId = customer.id
    await (prisma as any).partnerAccount.update({
      where: { id: session.partnerAccountId },
      data: { stripeCustomerId: customerId },
    })
  }

  const origin = req.headers.get('origin') ?? 'https://partners.bespoxai.com'

  const checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/partner/settings?billing=success`,
    cancel_url: `${origin}/partner/settings`,
  })

  return NextResponse.json({ sessionId: checkoutSession.id, url: checkoutSession.url })
}
