import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { sendVerificationEmail } from '@/lib/email'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

const TERMS_VERSION = '2026-08'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { companyName, country, bcVersion, email, termsAccepted } = body

  if (!companyName || !email) {
    return NextResponse.json({ error: 'Company name and email are required' }, { status: 400 })
  }

  if (termsAccepted !== true) {
    return NextResponse.json({ error: 'You must accept the Terms of Service to request access' }, { status: 400 })
  }

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  }

  // Check for duplicate pending signup request
  const existing = await prisma.signupRequest.findFirst({
    where: { email, activatedAt: null },
  })
  if (existing) {
    return NextResponse.json(
      { error: 'A signup request for this email is already pending' },
      { status: 409 }
    )
  }

  // Check for already-activated account with this email
  const existingUser = await prisma.user.findUnique({ where: { email } })
  if (existingUser) {
    return NextResponse.json(
      { error: 'An account with this email address already exists' },
      { status: 409 }
    )
  }

  // Generate secure verify token
  const verifyToken = crypto.randomBytes(32).toString('hex')

  await prisma.signupRequest.create({
    data: {
      companyName,
      country:   country   ?? 'NZ',
      bcVersion: bcVersion ?? 'BC25',
      email,
      verifyToken,
      termsAcceptedAt: new Date(),
      termsVersion:    TERMS_VERSION,
    },
  })

  await sendVerificationEmail(email, companyName, verifyToken)

  return NextResponse.json({ ok: true })
}
