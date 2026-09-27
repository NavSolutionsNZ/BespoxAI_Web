import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { RATE_LIMITS, clientIp, hitAndCheck, tooManyMessage } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  if (await hitAndCheck('reset-submit:ip:' + clientIp(req.headers), RATE_LIMITS.resetSubmitIp))
    return NextResponse.json({ error: tooManyMessage(RATE_LIMITS.resetSubmitIp.windowSec) }, { status: 429 })

  const { token, email, password } = await req.json().catch(() => ({}))
  if (!token || !email || !password)
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  if (password.length < 8)
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })

  // Find and validate token
  const record = await prisma.verificationToken.findUnique({
    where: { identifier_token: { identifier: `reset:${email}`, token } },
  })

  if (!record)
    return NextResponse.json({ error: 'Invalid or expired reset link. Please request a new one.' }, { status: 400 })
  if (record.expires < new Date())
    return NextResponse.json({ error: 'This reset link has expired. Please request a new one.' }, { status: 400 })

  // Update password
  const hashed = await bcrypt.hash(password, 12)
  await prisma.user.update({
    where: { email: email.toLowerCase().trim() },
    data:  { password: hashed },
  })

  // Delete used token
  await prisma.verificationToken.delete({
    where: { identifier_token: { identifier: `reset:${email}`, token } },
  })

  return NextResponse.json({ ok: true })
}
