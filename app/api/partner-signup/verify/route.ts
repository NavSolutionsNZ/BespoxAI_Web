import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { notifyAdminsPartnerSignupVerified, notifySendPartnerAgreement } from '@/lib/notifications'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.redirect(new URL('/partner-site/signup/verify?error=missing', req.url))

  const signup = await (prisma as any).partnerSignupRequest.findUnique({
    where: { verifyToken: token },
  })

  if (!signup) return NextResponse.redirect(new URL('/partner-site/signup/verify?error=invalid', req.url))
  if (signup.activatedAt) return NextResponse.redirect(new URL('/partner-site/signup/verify?status=already_activated', req.url))

  if (!signup.verifiedAt) {
    await (prisma as any).partnerSignupRequest.update({
      where: { verifyToken: token },
      data:  { verifiedAt: new Date() },
    })

    notifyAdminsPartnerSignupVerified({
      companyName: signup.companyName,
      contactName: signup.contactName,
      email:       signup.email,
    }).catch(e => console.error('[partner-verify] notify admins failed:', e))

    // Send partner agreement for review
    notifySendPartnerAgreement({
      to:          signup.email,
      contactName: signup.contactName,
      companyName: signup.companyName,
    }).catch(e => console.error('[partner-verify] send agreement failed:', e))
  }

  return NextResponse.redirect(new URL('/partner-site/signup/verify?status=verified', req.url))
}
