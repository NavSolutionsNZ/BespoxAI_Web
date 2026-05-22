import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/settings/profile — return current user's name fields
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const user = await (prisma as any).user.findUnique({
    where:  { id: userId },
    select: { firstName: true, lastName: true, preferredName: true, email: true },
  })
  return NextResponse.json({ profile: user })
}

// PATCH /api/settings/profile — update name fields
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const { firstName, lastName, preferredName } = await req.json().catch(() => ({}))
  const updated = await (prisma as any).user.update({
    where: { id: userId },
    data: {
      ...(firstName     !== undefined ? { firstName:     firstName?.trim()     || null } : {}),
      ...(lastName      !== undefined ? { lastName:      lastName?.trim()      || null } : {}),
      ...(preferredName !== undefined ? { preferredName: preferredName?.trim() || null } : {}),
      name: [firstName, lastName].filter(Boolean).join(' ').trim() || null,
    },
    select: { firstName: true, lastName: true, preferredName: true },
  })
  return NextResponse.json({ ok: true, profile: updated })
}
