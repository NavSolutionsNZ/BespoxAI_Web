/**
 * POST /api/settings/profile/change-password
 *
 * Changes the user's password. The current password is required unless the
 * account is flagged mustChangePassword (first sign-in with a temporary
 * password, which the user has just typed to get here). clearMustChange=true
 * only has that effect when the flag is actually set — otherwise anyone
 * holding a signed-in session could set a new password without knowing the
 * old one.
 *
 * Body: { currentPassword?, newPassword, clearMustChange? }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { prisma }                    from '@/lib/db'
import bcrypt                        from 'bcryptjs'
import { RATE_LIMITS, isLimited, hit, reset, tooManyMessage } from '@/lib/rate-limit'

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

  // Skip the current-password check only for a genuine forced first-login change
  const forcedChange = clearMustChange === true && user.mustChangePassword === true
  if (!forcedChange) {
    if (!currentPassword)
      return NextResponse.json({ error: 'Current password is required.' }, { status: 400 })
    const limitKey = 'change-pw:user:' + userId
    if (await isLimited(limitKey, RATE_LIMITS.changePwUser))
      return NextResponse.json({ error: tooManyMessage(RATE_LIMITS.changePwUser.windowSec) }, { status: 429 })
    const valid = await bcrypt.compare(currentPassword, user.password)
    if (!valid) {
      await hit(limitKey, RATE_LIMITS.changePwUser)
      return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 })
    }
    await reset(limitKey)
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
