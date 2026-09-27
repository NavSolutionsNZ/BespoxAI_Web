import { NextRequest, NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/api-auth'
import { getPlanByPriceId } from '@/lib/stripe-prices'
import { stripe } from '@/lib/stripe'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // Subscription changes are the tenant admin's decision
  const session = await requireTenantAdmin()
  if (session instanceof NextResponse)
    return NextResponse.json({ error: "Only your organisation's administrator can change billing or make payments." }, { status: 403 })

  const user = session.user as any
  const tenantId = user.tenantId
  if (!tenantId) return NextResponse.json({ error: 'No tenant' }, { status: 400 })

  const { priceId } = await req.json()
  if (!priceId) return NextResponse.json({ error: 'priceId required' }, { status: 400 })
  // Only BespoxAI plan prices — anything else would be treated as 'free' by the webhook
  if (!getPlanByPriceId(priceId)) return NextResponse.json({ error: 'Unknown plan' }, { status: 400 })

  const tenant = await (prisma as any).tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const existingSubId   = tenant.stripeSubscriptionId as string | null
  const existingStatus  = tenant.subscriptionStatus   as string | null

  // ── Existing active subscription → update in place (upgrade / downgrade) ──
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

    // Determine direction for the response label
    const MRR_RANK: Record<string, number> = {
      [process.env.STRIPE_PRICE_ASSISTANT_MONTHLY ?? '']: 1,
      [process.env.STRIPE_PRICE_ASSISTANT_ANNUAL  ?? '']: 2,
      [process.env.STRIPE_PRICE_MANAGER_MONTHLY   ?? '']: 3,
      [process.env.STRIPE_PRICE_MANAGER_ANNUAL    ?? '']: 4,
      [process.env.STRIPE_PRICE_EXECUTIVE_MONTHLY ?? '']: 5,
      [process.env.STRIPE_PRICE_EXECUTIVE_ANNUAL  ?? '']: 6,
    }
    const oldRank = MRR_RANK[existingPriceId ?? ''] ?? 0
    const newRank = MRR_RANK[priceId] ?? 0
    const direction = newRank > oldRank ? 'upgrade' : 'downgrade'

    return NextResponse.json({ updated: true, direction })
  }

  // ── No active subscription → new Stripe Checkout Session ─────────────────
  let customerId = tenant.stripeCustomerId as string | null

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: tenant.name,
      metadata: { tenantId },
    })
    customerId = customer.id
    await (prisma as any).tenant.update({
      where: { id: tenantId },
      data: { stripeCustomerId: customerId },
    })
  }

  const origin = req.headers.get('origin') ?? 'https://bespoxai.com'

  const checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/dashboard?billing=success`,
    cancel_url: `${origin}/billing`,
    metadata: { tenantId },
    subscription_data: { metadata: { tenantId } },
    allow_promotion_codes: true,
  })

  return NextResponse.json({ url: checkoutSession.url })
}
