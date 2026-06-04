import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { encryptToken } from '@/lib/crypto'

function isSuperadmin(session: any) {
  return session?.user?.role === 'superadmin'
}

// GET /api/admin/partners/[id]
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!isSuperadmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const partner = await (prisma as any).partnerAccount.findUnique({
    where: { id: params.id },
    include: {
      tenants: { select: { id: true, name: true, tunnelSubdomain: true, active: true } },
      users: {
        include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
      },
    },
  })

  if (!partner) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ ...partner, githubToken: partner.githubToken ? '••••••••' : null })
}

// PATCH /api/admin/partners/[id] — update fees, revenue share, branding, active status
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!isSuperadmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const allowed = [
    'name', 'billingEmail',
    'monthlyAccessFee', 'perDeveloperFee', 'perTenantFee', 'perUserFee',
    'revenueSharePartner', 'paymentMode',
    'isWhiteLabel', 'brandName', 'logoUrl', 'primaryColour', 'agentBrandName',
    'githubOrg', 'githubToken', 'fromEmail',
    'isActive',
  ]

  const data: any = { updatedAt: new Date() }
  for (const key of allowed) {
    if (key in body) {
      if (key === 'githubToken') {
        // Only encrypt if a new non-placeholder value is provided
        if (body.githubToken && body.githubToken !== '••••••••') {
          data.githubToken = encryptToken(body.githubToken)
        }
      } else {
        data[key] = body[key]
      }
    }
  }

  const partner = await (prisma as any).partnerAccount.update({
    where: { id: params.id },
    data,
  })

  return NextResponse.json({ ...partner, githubToken: partner.githubToken ? '••••••••' : null })
}
