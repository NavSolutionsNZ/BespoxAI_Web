/**
 * POST /api/settings/profile/change-password
 *
 * Changes the user's password. When clearMustChange=true (first-login flow),
 * also clears the mustChangePassword flag without requiring current password.
 * Otherwise validates current password first.
 *
 * Body: { currentPassword?, newPassword, clearMustChange? }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { prisma }                    from '@/lib/db'
import bcrypt                        from 'bcryptjs'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = (session.user as any).id as string
  const { currentPassword, newPassword, clearMustChange } = await req.json().catch(() => ({})) as {
    currentPassword?: string
    newPassword?:     string
    clearMustChange?: boolean
  }

  if (!newPassword || newPassword.length < 8)
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })

  const user = await (prisma as any).user.findUnique({
    where:  { id: userId },
    select: { password: true, mustChangePassword: true },
  })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // If NOT a forced first-login change, require current password
  if (!clearMustChange) {
    if (!currentPassword)
      return NextResponse.json({ error: 'Current password is required.' }, { status: 400 })
    const valid = await bcrypt.compare(currentPassword, user.password)
    if (!valid)
      return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 })
  }

  const hashed = await bcrypt.hash(newPassword, 12)

  await (prisma as any).user.update({
    where: { id: userId },
    data:  {
      password:           hashed,
      mustChangePassword: false,
    },
  })

  return NextResponse.json({ ok: true })
}
