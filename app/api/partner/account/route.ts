import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerSession } from '@/lib/partner-auth'
import { prisma } from '@/lib/db'

// GET /api/partner/account — return own PartnerAccount details + stats
export async function GET(req: NextRequest) {
  const session = await requirePartnerSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const partner = await (prisma as any).partnerAccount.findUnique({
    where: { id: session.partnerAccountId },
    include: {
      _count: { select: { tenants: true, users: true } },
    },
  })

  if (!partner) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Never expose the encrypted token
  return NextResponse.json({
    ...partner,
    githubToken: partner.githubToken ? '••••••••' : null,
  })
}

// PATCH /api/partner/account — update settings (admin only)
export async function PATCH(req: NextRequest) {
  const session = await requirePartnerSession('partner_admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const scalarFields = [
    'contactName', 'phone', 'address', 'gstNumber', 'billingEmail',
    'brandName', 'logoUrl', 'primaryColour', 'isWhiteLabel', 'agentBrandName',
    'fromEmail', 'githubOrg',
  ]

  const data: any = { updatedAt: new Date() }
  for (const key of scalarFields) {
    if (key in body) data[key] = body[key]
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

  return NextResponse.json({ ...partner, githubToken: partner.githubToken ? '••••••••' : null })
}
