import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenantId = (session.user as any).tenantId
  if (!tenantId) return NextResponse.json({ tier: 'free', subscriptionStatus: null, prices: {} })

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { tier: true, trialEndsAt: true },
  })

  // Resolve subscription status separately (new field, use as any)
  const tenantFull = await (prisma as any).tenant.findUnique({
    where: { id: tenantId },
    select: { subscriptionStatus: true },
  })

  // Price IDs are server-only env vars — expose them here so the client billing page can use them
  // Also resolve the actual plan name from Stripe if the tenant has an active subscription
  let planName: string | null = null
  try {
    const { stripe } = await import('@/lib/stripe')
    const { prisma: db } = await import('@/lib/db')
    const t = await (db as any).tenant.findUnique({ where: { id: tenantId }, select: { stripeCustomerId: true } })
    if (t?.stripeCustomerId) {
      const subs = await stripe.subscriptions.list({ customer: t.stripeCustomerId, status: 'active', limit: 1, expand: ['data.items.data.price.product'] })
      if (subs.data.length > 0) {
        const product = subs.data[0].items.data[0]?.price?.product
        planName = typeof product === 'object' && product !== null ? (product as any).name : null
      }
    }
  } catch { /* non-fatal */ }

  return NextResponse.json({
    tier: tenant?.tier ?? 'free',
    planName,
    subscriptionStatus: tenantFull?.subscriptionStatus ?? null,
    trialEndsAt: tenant?.trialEndsAt ?? null,
    prices: {
      starter_month:    process.env.STRIPE_PRICE_STARTER_MONTHLY   ?? null,
      starter_year:     process.env.STRIPE_PRICE_STARTER_ANNUAL    ?? null,
      assistant_month:  process.env.STRIPE_PRICE_ASSISTANT_MONTHLY ?? null,
      assistant_year:   process.env.STRIPE_PRICE_ASSISTANT_ANNUAL  ?? null,
      manager_month:    process.env.STRIPE_PRICE_MANAGER_MONTHLY   ?? null,
      manager_year:     process.env.STRIPE_PRICE_MANAGER_ANNUAL    ?? null,
      executive_month:  process.env.STRIPE_PRICE_EXECUTIVE_MONTHLY ?? null,
      executive_year:   process.env.STRIPE_PRICE_EXECUTIVE_ANNUAL  ?? null,
    },
  })
}
