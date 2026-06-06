import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerSession } from '@/lib/partner-auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/partner/profile — return current partner user's name fields
export async function GET(req: NextRequest) {
  const session = await requirePartnerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await (prisma as any).user.findUnique({
    where: { id: session.userId },
    select: { firstName: true, lastName: true, preferredName: true, email: true },
  })

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  return NextResponse.json({ profile: user })
}

// PATCH /api/partner/profile — update name fields (any partner can update their own)
export async function PATCH(req: NextRequest) {
  const session = await requirePartnerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { firstName, lastName, preferredName } = await req.json().catch(() => ({}))

  const updated = await (prisma as any).user.update({
    where: { id: session.userId },
    data: {
      ...(firstName !== undefined ? { firstName: firstName?.trim() || null } : {}),
      ...(lastName !== undefined ? { lastName: lastName?.trim() || null } : {}),
      ...(preferredName !== undefined ? { preferredName: preferredName?.trim() || null } : {}),
      name: [firstName, lastName].filter(Boolean).join(' ').trim() || null,
    },
    select: { firstName: true, lastName: true, preferredName: true, email: true },
  })

  return NextResponse.json({ ok: true, profile: updated })
}
