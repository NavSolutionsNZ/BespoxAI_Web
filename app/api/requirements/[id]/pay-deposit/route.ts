/**
 * POST /api/requirements/[id]/pay-deposit
 *
 * Creates a Stripe Checkout session for the 20% deposit on an accepted quote.
 * Also marks the quote as accepted (quoteApprovedAt) and sets depositAmount.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { stripe } from '@/lib/stripe'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const requirementId = params.id

  const requirement = await (prisma as any).requirement.findUnique({
    where: { id: requirementId },
    include: {
      user:   { select: { name: true, email: true } },
      tenant: { select: { name: true } },
    },
  })

  if (!requirement)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (user.role !== 'superadmin' && requirement.tenantId !== user.tenantId)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (requirement.status !== 'quoted')
    return NextResponse.json({ error: 'Requirement is not in quoted status' }, { status: 400 })

  if (!requirement.quote)
    return NextResponse.json({ error: 'No quote amount set' }, { status: 400 })

  const quoteAmount   = parseFloat(requirement.quote.toString())
  const depositAmount = Math.round(quoteAmount * 0.2 * 100) // 20% in NZD cents

  // Mark quote as accepted and record deposit amount immediately
  await (prisma as any).requirement.update({
    where: { id: requirementId },
    data: {
      quoteApprovedAt: new Date(),
      depositAmount:   (quoteAmount * 0.2).toFixed(2),
    },
  })

  // Ensure the tenant has a Stripe customer record
  const tenant = await (prisma as any).tenant.findUnique({ where: { id: user.tenantId } })
  let customerId = tenant?.stripeCustomerId as string | null

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name:  tenant?.name ?? '',
      metadata: { tenantId: user.tenantId },
    })
    customerId = customer.id
    await (prisma as any).tenant.update({
      where: { id: user.tenantId },
      data:  { stripeCustomerId: customerId },
    })
  }

  const origin = req.headers.get('origin') ?? 'https://bespoxai.com'

  const checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'nzd',
          product_data: {
            name:        `Development Deposit — ${requirement.title}`,
            description: `20% deposit on $${quoteAmount.toLocaleString('en-NZ', { minimumFractionDigits: 2 })} NZD quote. Balance due on completion.`,
          },
          unit_amount: depositAmount,
        },
        quantity: 1,
      },
    ],
    success_url: `${origin}/dashboard?view=customisations&deposit=paid`,
    cancel_url:  `${origin}/dashboard?view=customisations`,
    metadata: {
      paymentType:   'requirement_deposit',
      requirementId,
      tenantId: user.tenantId,
    },
  })

  return NextResponse.json({ checkoutUrl: checkoutSession.url })
}
