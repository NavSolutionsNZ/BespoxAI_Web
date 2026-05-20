import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { stripe } from '@/lib/stripe'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// cents → dollars
function cents(n: number | null) { return Math.round((n ?? 0) / 100) }

// Monthly equivalent MRR for a price
function mrrOf(priceId: string | null): number {
  if (!priceId) return 0
  const map: Record<string, number> = {
    [process.env.STRIPE_PRICE_ASSISTANT_MONTHLY ?? '']: 299,
    [process.env.STRIPE_PRICE_ASSISTANT_ANNUAL  ?? '']: Math.round(3289 / 12),
    [process.env.STRIPE_PRICE_MANAGER_MONTHLY   ?? '']: 499,
    [process.env.STRIPE_PRICE_MANAGER_ANNUAL    ?? '']: Math.round(5489 / 12),
    [process.env.STRIPE_PRICE_EXECUTIVE_MONTHLY ?? '']: 999,
    [process.env.STRIPE_PRICE_EXECUTIVE_ANNUAL  ?? '']: Math.round(10989 / 12),
  }
  return map[priceId] ?? 0
}

function planLabel(priceId: string | null): string {
  if (!priceId) return 'Unknown'
  const map: Record<string, string> = {
    [process.env.STRIPE_PRICE_ASSISTANT_MONTHLY ?? '']: 'Assistant (monthly)',
    [process.env.STRIPE_PRICE_ASSISTANT_ANNUAL  ?? '']: 'Assistant (annual)',
    [process.env.STRIPE_PRICE_MANAGER_MONTHLY   ?? '']: 'Manager (monthly)',
    [process.env.STRIPE_PRICE_MANAGER_ANNUAL    ?? '']: 'Manager (annual)',
    [process.env.STRIPE_PRICE_EXECUTIVE_MONTHLY ?? '']: 'Executive (monthly)',
    [process.env.STRIPE_PRICE_EXECUTIVE_ANNUAL  ?? '']: 'Executive (annual)',
  }
  return map[priceId] ?? priceId
}

function tierOf(priceId: string | null): 'assistant' | 'manager' | 'executive' | 'unknown' {
  if (!priceId) return 'unknown'
  if ([process.env.STRIPE_PRICE_ASSISTANT_MONTHLY, process.env.STRIPE_PRICE_ASSISTANT_ANNUAL].includes(priceId)) return 'assistant'
  if ([process.env.STRIPE_PRICE_MANAGER_MONTHLY,   process.env.STRIPE_PRICE_MANAGER_ANNUAL].includes(priceId))   return 'manager'
  if ([process.env.STRIPE_PRICE_EXECUTIVE_MONTHLY, process.env.STRIPE_PRICE_EXECUTIVE_ANNUAL].includes(priceId)) return 'executive'
  return 'unknown'
}

function tierCounts(items: { priceId: string | null }[]) {
  return items.reduce((acc, s) => {
    const t = tierOf(s.priceId)
    acc[t] = (acc[t] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'superadmin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const now        = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthStartUnix = Math.floor(monthStart.getTime() / 1000)
  const todayStartUnix = Math.floor(todayStart.getTime() / 1000)

  // ── Fetch data from Stripe in parallel ───────────────────────────────────
  const [activeSubs, cancelledSubs, updateEvents, paidReviews] = await Promise.all([
    stripe.subscriptions.list({ status: 'active',   limit: 100, expand: ['data.customer'] }),
    stripe.subscriptions.list({ status: 'canceled', limit: 100, expand: ['data.customer'] }),
    stripe.events.list({ type: 'customer.subscription.updated', created: { gte: monthStartUnix }, limit: 100 }),
    prisma.requirement.findMany({
      where: { reviewPaidAt: { not: null } },
      orderBy: { reviewPaidAt: 'desc' },
      select: {
        id: true, title: true, reviewPaidAt: true,
        tenant: { select: { name: true } },
        user:   { select: { name: true, email: true } },
      },
    }).catch(() => [] as any[]),
  ])

  const activeList = activeSubs.data
  const activeCustomerIds = new Set(activeList.map(s => s.customer as string))

  // ── MRR ───────────────────────────────────────────────────────────────────
  const mrr = activeList.reduce((sum, s) => sum + mrrOf(s.items.data[0]?.price?.id ?? null), 0)

  // ── Plan changes this month (from subscription.updated events) ────────────
  const upgrades:   { customer: string; from: string; to: string; mrrDelta: number; changedAt: string }[] = []
  const downgrades: { customer: string; from: string; to: string; mrrDelta: number; changedAt: string }[] = []

  for (const event of updateEvents.data) {
    const sub      = event.data.object as any
    const prevAttr = event.data.previous_attributes as any

    // Only care about price changes
    const oldPriceId = prevAttr?.items?.data?.[0]?.price?.id as string | undefined
    const newPriceId = sub?.items?.data?.[0]?.price?.id as string | undefined
    if (!oldPriceId || !newPriceId || oldPriceId === newPriceId) continue

    const oldMRR   = mrrOf(oldPriceId)
    const newMRR   = mrrOf(newPriceId)
    const mrrDelta = Math.abs(newMRR - oldMRR)
    const customer = typeof sub.customer === 'string' ? sub.customer : (sub.customer?.email ?? 'Unknown')

    const entry = {
      customer: (sub.customer as any)?.email ?? customer,
      from:     planLabel(oldPriceId),
      to:       planLabel(newPriceId),
      mrrDelta,
      changedAt: new Date(event.created * 1000).toISOString(),
    }

    if (newMRR > oldMRR) upgrades.push(entry)
    else downgrades.push(entry)
  }

  // ── Genuine new subscriptions (not plan changes) ──────────────────────────
  // A subscription is "new" if it started this month AND the customer has
  // no subscription.updated event this month (i.e. it wasn't a plan switch)
  const changedCustomers = new Set([
    ...upgrades.map(u => u.customer),
    ...downgrades.map(d => d.customer),
  ])

  // We use customer email from expand — need a lookup
  const newThisMonth = activeList.filter(s => {
    if (s.start_date * 1000 < monthStart.getTime()) return false
    const cust = s.customer as any
    const email = cust?.email ?? ''
    return !changedCustomers.has(email)
  })

  const newToday = newThisMonth.filter(s => s.start_date * 1000 >= todayStart.getTime())

  const newMonthValue = newThisMonth.reduce((sum, s) => sum + cents(s.items.data[0]?.price?.unit_amount ?? 0), 0)
  const newTodayValue = newToday.reduce((sum, s) => sum + cents(s.items.data[0]?.price?.unit_amount ?? 0), 0)

  const newMonthList = newThisMonth.map(s => {
    const customer = s.customer as any
    return {
      customer:  customer?.email ?? 'Unknown',
      plan:      planLabel(s.items.data[0]?.price?.id ?? null),
      startedAt: new Date(s.start_date * 1000).toISOString(),
      valueNZD:  cents(s.items.data[0]?.price?.unit_amount ?? 0),
    }
  })

  // ── Cancellations (genuine churn — no active sub remaining) ──────────────
  const cancelledThisMonth = cancelledSubs.data.filter(s => {
    if ((s.canceled_at ?? 0) * 1000 < monthStart.getTime()) return false
    if (activeCustomerIds.has(s.customer as string)) return false // upgrade, not churn
    return true
  })

  const cancellations = cancelledThisMonth.map(s => {
    const customer = s.customer as any
    const details  = (s as any).cancellation_details ?? {}
    const priceId  = s.items.data[0]?.price?.id ?? null
    const lostMRR  = mrrOf(priceId)
    return {
      customer:    customer?.email ?? customer?.name ?? 'Unknown',
      plan:        planLabel(priceId),
      cancelledAt: new Date((s.canceled_at ?? 0) * 1000).toISOString(),
      reason:      details.reason   ?? null,
      feedback:    details.feedback ?? null,
      comment:     details.comment  ?? null,
      lostMRR,
    }
  })

  const totalLostMRR = [
    ...cancellations.map(c => c.lostMRR),
    ...downgrades.map(d => d.mrrDelta),
  ].reduce((a, b) => a + b, 0)

  // ── Spec review payments (from DB, $249 NZD each) ────────────────────────
  const REVIEW_FEE = 249
  const reviewsThisMonth = paidReviews.filter(r => new Date(r.reviewPaidAt!) >= monthStart)
  const reviewStats = {
    allTime: {
      count:      paidReviews.length,
      revenueNZD: paidReviews.length * REVIEW_FEE,
    },
    thisMonth: {
      count:      reviewsThisMonth.length,
      revenueNZD: reviewsThisMonth.length * REVIEW_FEE,
    },
    list: paidReviews.slice(0, 20).map(r => ({
      tenant:    r.tenant.name,
      customer:  r.user.name || r.user.email,
      title:     r.title,
      paidAt:    r.reviewPaidAt!.toISOString(),
      amountNZD: REVIEW_FEE,
    })),
  }

  return NextResponse.json({
    mrr,
    active:    activeList.length,
    byTier:    tierCounts(activeList.map(s => ({ priceId: s.items.data[0]?.price?.id ?? null }))),
    newToday:  {
      count: newToday.length,
      valueNZD: newTodayValue,
      byTier: tierCounts(newToday.map(s => ({ priceId: s.items.data[0]?.price?.id ?? null }))),
    },
    newMonth:  {
      count: newThisMonth.length,
      valueNZD: newMonthValue,
      byTier: tierCounts(newThisMonth.map(s => ({ priceId: s.items.data[0]?.price?.id ?? null }))),
      list: newMonthList,
    },
    upgrades:   { count: upgrades.length,   list: upgrades },
    downgrades: { count: downgrades.length, list: downgrades, lostMRR: downgrades.reduce((s,d) => s+d.mrrDelta, 0) },
    cancelled:  { count: cancellations.length, lostMRR: cancellations.reduce((s,c) => s+c.lostMRR, 0), list: cancellations },
    totalLostMRR,
    reviews: reviewStats,
  })
}
