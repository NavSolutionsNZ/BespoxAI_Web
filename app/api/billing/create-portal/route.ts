import { NextRequest, NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/api-auth'
import { stripe } from '@/lib/stripe'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // The Stripe portal can cancel the plan and change payment details — admin only
  const session = await requireTenantAdmin()
  if (session instanceof NextResponse)
    return NextResponse.json({ error: "Only your organisation's administrator can change billing or make payments." }, { status: 403 })

  const tenantId = (session.user as any).tenantId
  if (!tenantId) return NextResponse.json({ error: 'No tenant' }, { status: 400 })

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
  const customerId = (tenant as any)?.stripeCustomerId as string | null

  if (!customerId) {
    return NextResponse.json({ error: 'No billing account found. Please subscribe first.' }, { status: 400 })
  }

  const origin = req.headers.get('origin') ?? 'https://bespoxai.com'

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/dashboard`,
  })

  return NextResponse.json({ url: portalSession.url })
}
