/**
 * POST /api/webhooks/stripe
 * Handles all Stripe webhook events.
 * Must be excluded from NextAuth middleware (no auth header).
 */
import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { prisma } from '@/lib/db'
import { getPlanByPriceId } from '@/lib/stripe-prices'
import type Stripe from 'stripe'
import { notifyAdminsDepositPaid } from '@/lib/notifications'

export const dynamic = 'force-dynamic'

// Raw body required for Stripe signature verification
export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!sig || !webhookSecret) {
    return NextResponse.json({ error: 'Missing signature or secret' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch (err: any) {
    console.error('[Stripe Webhook] Signature verification failed:', err.message)
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 })
  }

  console.log(`[Stripe Webhook] Event: ${event.type}`)

  try {
    switch (event.type) {

      // ── Subscription created or updated ──────────────────────────────────
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        await handleSubscriptionChange(sub)
        break
      }

      // ── Subscription cancelled / deleted ─────────────────────────────────
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        await handleSubscriptionDeleted(sub)
        break
      }

      // ── Payment succeeded (one-time: deposit or balance) ─────────────────
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        await handleCheckoutCompleted(session)
        break
      }

      // ── Recurring invoice paid ────────────────────────────────────────────
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice
        await handleInvoicePaid(invoice)
        break
      }

      // ── Payment failed ────────────────────────────────────────────────────
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        await handleInvoiceFailed(invoice)
        break
      }

      default:
        // Unhandled event — ignore
        break
    }
  } catch (err: any) {
    console.error(`[Stripe Webhook] Handler error for ${event.type}:`, err)
    // Return 200 so Stripe doesn't retry — log for investigation
    return NextResponse.json({ error: 'Handler error', detail: err.message }, { status: 200 })
  }

  return NextResponse.json({ received: true })
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function handleSubscriptionChange(sub: Stripe.Subscription) {
  const customerId = sub.customer as string
  const priceId = sub.items.data[0]?.price?.id
  const status = sub.status // active | trialing | past_due | cancelled | etc.

  if (!priceId) return

  // ── Check if this is a partner subscription ──
  const partner = await (prisma as any).partnerAccount.findUnique({
    where: { stripeCustomerId: customerId },
  })

  if (partner) {
    // Handle partner subscription
    const { getPartnerPlanByPriceId } = await import('@/lib/partner-plans')
    const plan = getPartnerPlanByPriceId(priceId)
    const tier = plan?.id ?? 'unbranded'

    await (prisma as any).partnerAccount.update({
      where: { id: partner.id },
      data: {
        stripeSubscriptionId: sub.id,
        subscriptionStatus: status,
        subscriptionTier: status === 'active' || status === 'trialing' ? tier : 'unbranded',
        // Auto-enable white-label if on branded plan and subscription is active
        isWhiteLabel: status === 'active' && tier === 'branded' ? true : partner.isWhiteLabel,
      },
    })
    return
  }

  // ── Otherwise handle as tenant subscription ──
  const plan = getPlanByPriceId(priceId)
  const tier = plan?.id ?? 'free'

  await (prisma as any).tenant.updateMany({
    where: { stripeCustomerId: customerId },
    data: {
      stripeSubscriptionId: sub.id,
      stripePriceId: priceId,
      subscriptionStatus: status,
      tier: status === 'active' || status === 'trialing' ? tier : 'free',
    },
  })
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
  const customerId = sub.customer as string
  const details = (sub as any).cancellation_details ?? {}

  // ── Check if this is a partner subscription ──
  const partner = await (prisma as any).partnerAccount.findUnique({
    where: { stripeCustomerId: customerId },
  })

  if (partner) {
    // Handle partner subscription cancellation
    await (prisma as any).partnerAccount.update({
      where: { id: partner.id },
      data: {
        stripeSubscriptionId: null,
        subscriptionStatus: 'cancelled',
        subscriptionTier: 'unbranded',
        isWhiteLabel: false, // Disable white-label on cancellation
      },
    })
    return
  }

  // ── Otherwise handle as tenant subscription ──
  await (prisma as any).tenant.updateMany({
    where: { stripeCustomerId: customerId },
    data: {
      stripeSubscriptionId: null,
      stripePriceId: null,
      subscriptionStatus: 'cancelled',
      tier: 'free',
      cancelledAt: new Date(),
      cancellationReason: details.reason ?? null,
      cancellationFeedback: [details.feedback, details.comment].filter(Boolean).join(' — ') || null,
    },
  })
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const mode = session.mode
  const metadata = session.metadata ?? {}

  // ── Subscription checkout ─────────────────────────────────────────────────
  if (mode === 'subscription') {
    // Subscription events handled via customer.subscription.* — nothing to do here
    // But ensure stripeCustomerId is linked if first checkout
    const tenantId = metadata.tenantId
    const customerId = session.customer as string
    if (tenantId && customerId) {
      await (prisma as any).tenant.update({
        where: { id: tenantId },
        data: { stripeCustomerId: customerId },
      })
    }
    return
  }

  // ── One-time payment ──────────────────────────────────────────────────────
  const paymentType = metadata.paymentType // 'requirement_deposit' | 'requirement_balance' | 'migration_deposit'

  if (paymentType === 'requirement_deposit') {
    const requirementId = metadata.requirementId
    if (!requirementId) return
    const updatedReq = await (prisma as any).requirement.update({
      where:   { id: requirementId },
      data:    { depositPaidAt: new Date(), depositStripeSessionId: session.id, status: 'deposit_paid' },
      include: { user: { select: { name: true, email: true } }, tenant: { select: { name: true } } },
    })
    // Notify superadmins
    notifyAdminsDepositPaid({
      title:         updatedReq.title,
      tenantName:    updatedReq.tenant?.name ?? '',
      customerName:  updatedReq.user?.name ?? updatedReq.user?.email ?? 'Customer',
      depositAmount: updatedReq.depositAmount ? parseFloat(updatedReq.depositAmount.toString()) : 0,
    })
  }

  if (paymentType === 'requirement_balance') {
    const requirementId = metadata.requirementId
    if (!requirementId) return
    await (prisma as any).requirement.update({
      where: { id: requirementId },
      data: {
        balancePaidAt: new Date(),
        balanceStripeSessionId: session.id,
        status: 'fully_paid',
      },
    })
  }

  if (paymentType === 'migration_deposit') {
    const enquiryId = metadata.enquiryId
    if (!enquiryId) return
    await (prisma as any).migrationEnquiry.update({
      where: { id: enquiryId },
      data: {
        depositPaidAt: new Date(),
        depositStripeSessionId: session.id,
        status: 'deposit_paid',
      },
    })
  }

  if (paymentType === 'spec_review') {
    const requirementId = metadata.requirementId
    if (!requirementId) return
    const now = new Date()
    await (prisma as any).requirement.update({
      where: { id: requirementId },
      data: {
        reviewPaidAt: now,
        reviewStripeSessionId: session.id,
        reviewSubmittedAt: now,
        status: 'submitted',
      },
    })
  }
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  // Keep subscription status in sync on each renewal
  const customerId = invoice.customer as string
  const subId = (invoice as any).subscription as string | null
  if (!subId) return

  await (prisma as any).tenant.updateMany({
    where: { stripeCustomerId: customerId },
    data: { subscriptionStatus: 'active' },
  })
}

async function handleInvoiceFailed(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string
  await (prisma as any).tenant.updateMany({
    where: { stripeCustomerId: customerId },
    data: { subscriptionStatus: 'past_due' },
  })
}
