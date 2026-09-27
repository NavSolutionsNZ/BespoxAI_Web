import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerSession } from '@/lib/partner-auth'
import { prisma } from '@/lib/db'
import { revalidateTag } from 'next/cache'
import { isAllowedFromEmail, requestFromEmailVerification } from '@/lib/partner-from-email'

// GET /api/partner/account — return own PartnerAccount details + stats
export async function GET(req: NextRequest) {
  const session = await requirePartnerSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const partner = await (prisma as any).partnerAccount.findUnique({
    where: { id: session.partnerAccountId },
    select: {
      id: true, name: true, slug: true, contactName: true, phone: true, address: true,
      gstNumber: true, billingEmail: true, brandName: true, logoUrl: true,
      agentBrandName: true, isWhiteLabel: true, fromEmail: true, fromEmailVerifiedAt: true, githubOrg: true,
      githubToken: true, stripeCustomerId: true, stripeSubscriptionId: true,
      subscriptionStatus: true, subscriptionTier: true, partnerTheme: true, createdAt: true, updatedAt: true,
      _count: { select: { tenants: true, users: true } },
    },
  })

  if (!partner) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Never expose the encrypted token; billing identifiers are for partner admins
  const isAdmin = session.partnerRole === 'partner_admin'
  return NextResponse.json({
    ...partner,
    githubToken: partner.githubToken ? '••••••••' : null,
    ...(isAdmin ? {} : { stripeCustomerId: null, stripeSubscriptionId: null, gstNumber: null }),
  })
}

// PATCH /api/partner/account — update settings (admin only)
export async function PATCH(req: NextRequest) {
  const session = await requirePartnerSession('partner_admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const scalarFields = [
    'contactName', 'phone', 'address', 'gstNumber', 'billingEmail',
    'brandName', 'logoUrl', 'isWhiteLabel', 'agentBrandName',
    'fromEmail', 'githubOrg', 'partnerTheme',
  ]

  const data: any = { updatedAt: new Date() }
  for (const key of scalarFields) {
    if (key in body) data[key] = body[key]
  }

  // White-label is a paid feature (branded plan). Partners may switch it off at
  // any time, but only switch it on while the branded plan is active — the
  // Stripe webhook sets it on subscription; this stops a free enable.
  if (data.isWhiteLabel === true) {
    const acct = await (prisma as any).partnerAccount.findUnique({
      where:  { id: session.partnerAccountId },
      select: { subscriptionTier: true, subscriptionStatus: true, isWhiteLabel: true },
    })
    const branded = acct?.subscriptionTier === 'branded' && ['active', 'trialing'].includes(acct?.subscriptionStatus ?? '')
    if (!branded && !acct?.isWhiteLabel) delete data.isWhiteLabel
  }

  // From address: never set directly. A new address gets a confirmation link;
  // it's used only after someone with access to that mailbox clicks it.
  let fromEmailPending: string | null = null
  if ('fromEmail' in data) {
    const requested = String(data.fromEmail ?? '').trim().toLowerCase()
    delete data.fromEmail
    const current = await (prisma as any).partnerAccount.findUnique({
      where:  { id: session.partnerAccountId },
      select: { name: true, fromEmail: true, fromEmailVerifiedAt: true },
    })
    if (!requested) {
      data.fromEmail = null
      data.fromEmailVerifiedAt = null
    } else if (!(requested === current?.fromEmail && current?.fromEmailVerifiedAt)) {
      if (!isAllowedFromEmail(requested))
        return NextResponse.json({ error: 'Use an address on your own company domain.' }, { status: 400 })
      await requestFromEmailVerification(session.partnerAccountId, current?.name ?? 'Your partner account', requested)
      fromEmailPending = requested
    }
  }

  // GitHub token — encrypt if a new non-placeholder value provided
  if ('githubToken' in body && body.githubToken && body.githubToken !== '••••••••') {
    const { encryptToken } = await import('@/lib/crypto')
    data.githubToken = encryptToken(body.githubToken)
  }

  const partner = await (prisma as any).partnerAccount.update({
    where: { id: session.partnerAccountId },
    data,
  })

  // Branding may have changed — bust the cached /api/branding response
  revalidateTag('branding')

  return NextResponse.json({ ...partner, githubToken: partner.githubToken ? '••••••••' : null, fromEmailPending })
}
