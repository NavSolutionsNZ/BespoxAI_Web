import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { sendPasswordResetEmail } from '@/lib/email'
import crypto from 'crypto'
import { RATE_LIMITS, clientIp, hitAndCheck } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const { email } = await req.json().catch(() => ({}))
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

  // Limit reset emails per address and per IP. Over the limit we still answer
  // ok (as for unknown emails) so the response never reveals anything.
  const normalised = String(email).toLowerCase().trim()
  const overIp    = await hitAndCheck('reset:ip:' + clientIp(req.headers), RATE_LIMITS.resetIp)
  const overEmail = await hitAndCheck('reset:email:' + normalised, RATE_LIMITS.resetEmail)
  if (overIp || overEmail) {
    console.warn('[forgot-password] throttled', overIp ? 'ip' : 'email')
    return NextResponse.json({ ok: true })
  }

  // Always return success to prevent email enumeration
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })
  if (!user || !user.active) return NextResponse.json({ ok: true })

  // Delete any existing reset token for this user
  await prisma.verificationToken.deleteMany({ where: { identifier: `reset:${email}` } })

  const token   = crypto.randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

  await prisma.verificationToken.create({
    data: { identifier: `reset:${email}`, token, expires },
  })

  const resetUrl = `${process.env.NEXTAUTH_URL}/reset-password?token=${token}&email=${encodeURIComponent(email)}`
  await sendPasswordResetEmail(email, resetUrl)

  return NextResponse.json({ ok: true })
}
