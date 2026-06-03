import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { encryptToken } from '@/lib/crypto'

function isSuperadmin(session: any) {
  return session?.user?.role === 'superadmin'
}

// GET /api/admin/partners — list all partner accounts with stats
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!isSuperadmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const partners = await (prisma as any).partnerAccount.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: { tenants: true, users: true },
      },
    },
  })

  // Strip githubToken from response — write-only
  const safe = partners.map((p: any) => ({
    ...p,
    githubToken: p.githubToken ? '••••••••' : null,
    _count: p._count,
  }))

  return NextResponse.json(safe)
}

// POST /api/admin/partners — create a new partner account
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!isSuperadmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const {
    name, slug, billingEmail,
    monthlyAccessFee = 0, perDeveloperFee = 0, perTenantFee = 0, perUserFee = 0,
    revenueSharePartner = 0.60,
    paymentMode = 'bespoxai_collected',
    isWhiteLabel = false, brandName, logoUrl, primaryColour, agentBrandName,
    githubOrg, githubToken,
    isActive = true,
  } = body

  if (!name || !slug || !billingEmail) {
    return NextResponse.json({ error: 'name, slug, and billingEmail are required' }, { status: 400 })
  }

  // Validate slug format
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json({ error: 'slug must be lowercase alphanumeric with hyphens only' }, { status: 400 })
  }

  // Check slug uniqueness
  const existing = await (prisma as any).partnerAccount.findUnique({ where: { slug } })
  if (existing) return NextResponse.json({ error: 'slug already in use' }, { status: 409 })

  const data: any = {
    id: crypto.randomUUID(),
    name, slug, billingEmail,
    monthlyAccessFee, perDeveloperFee, perTenantFee, perUserFee,
    revenueSharePartner,
    paymentMode,
    isWhiteLabel,
    isActive,
    updatedAt: new Date(),
  }

  if (brandName)      data.brandName      = brandName
  if (logoUrl)        data.logoUrl        = logoUrl
  if (primaryColour)  data.primaryColour  = primaryColour
  if (agentBrandName) data.agentBrandName = agentBrandName
  if (githubOrg)      data.githubOrg      = githubOrg
  if (githubToken)    data.githubToken    = encryptToken(githubToken)

  const partner = await (prisma as any).partnerAccount.create({ data })

  return NextResponse.json({ ...partner, githubToken: partner.githubToken ? '••••••••' : null }, { status: 201 })
}
