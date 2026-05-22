import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { notifyAdminsSignupVerified } from '@/lib/notifications'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  }

  const signup = await prisma.signupRequest.findUnique({
    where: { verifyToken: token },
  })

  if (!signup) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 404 })
  }

  if (signup.verifiedAt) {
    // Already verified — just redirect to a thank-you state
    return NextResponse.redirect(new URL('/signup/verify?status=already', req.url))
  }

  // Check 48h expiry
  const age = Date.now() - new Date(signup.createdAt).getTime()
  if (age > 48 * 60 * 60 * 1000) {
    return NextResponse.redirect(new URL('/signup/verify?status=expired', req.url))
  }

  await prisma.signupRequest.update({
    where: { verifyToken: token },
    data:  { verifiedAt: new Date() },
  })

  // Fire-and-forget — notify superadmins that action is required
  notifyAdminsSignupVerified({ companyName: signup.companyName, email: signup.email }).catch(() => {})

  return NextResponse.redirect(new URL('/signup/verify?status=success', req.url))
}
