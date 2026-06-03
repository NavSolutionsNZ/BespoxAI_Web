import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { sendEmail } from '@/lib/email'
import crypto from 'crypto'

const PORTAL = process.env.NEXTAUTH_URL ?? 'https://bespoxai.com'

// NZ GST number: 8 or 9 digits, optionally hyphenated (e.g. 12-345-678 or 123-456-789)
function validateGst(gst: string): boolean {
  const digits = gst.replace(/[-\s]/g, '')
  return /^\d{8,9}$/.test(digits)
}

function formatGst(gst: string): string {
  const digits = gst.replace(/[-\s]/g, '')
  if (digits.length === 9) return digits.slice(0, 3) + '-' + digits.slice(3, 6) + '-' + digits.slice(6)
  if (digits.length === 8) return digits.slice(0, 2) + '-' + digits.slice(2, 5) + '-' + digits.slice(5)
  return gst
}

function generateSlug(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40)
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const {
    companyName, contactName, email, phone, address,
    gstNumber, paymentMode, bankAccount, billingEmail,
  } = body

  // Required field validation
  const missing = ['companyName', 'contactName', 'email', 'phone', 'address'].filter(f => !body[f])
  if (missing.length) {
    return NextResponse.json({ error: 'Missing required fields: ' + missing.join(', ') }, { status: 400 })
  }

  if (paymentMode === 'bespoxai_collected' && !bankAccount) {
    return NextResponse.json({ error: 'Bank account is required when BespoxAI collects payments' }, { status: 400 })
  }

  if (gstNumber && !validateGst(gstNumber)) {
    return NextResponse.json({ error: 'Invalid GST number — must be 8 or 9 digits (e.g. 123-456-789)' }, { status: 400 })
  }

  // Check email not already used
  const existingUser = await (prisma as any).user.findUnique({ where: { email: email.toLowerCase().trim() } })
  if (existingUser) {
    return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 })
  }

  const existingSignup = await (prisma as any).partnerSignupRequest.findFirst({
    where: { email: email.toLowerCase().trim(), activatedAt: null },
  })
  if (existingSignup) {
    return NextResponse.json({ error: 'A signup request for this email is already pending' }, { status: 409 })
  }

  // Generate unique slug
  let slug = generateSlug(companyName)
  const slugExists = await (prisma as any).partnerAccount.findUnique({ where: { slug } })
  if (slugExists) {
    slug = slug + '-' + Math.floor(Math.random() * 900 + 100)
  }

  const verifyToken = crypto.randomBytes(32).toString('hex')

  await (prisma as any).partnerSignupRequest.create({
    data: {
      id:          crypto.randomUUID(),
      companyName: companyName.trim(),
      slug,
      billingEmail: (billingEmail || email).toLowerCase().trim(),
      email:        email.toLowerCase().trim(),
      contactName:  contactName.trim(),
      phone:        phone.trim(),
      address:      address.trim(),
      gstNumber:    gstNumber ? formatGst(gstNumber) : null,
      paymentMode:  paymentMode ?? 'bespoxai_collected',
      bankAccount:  bankAccount ? bankAccount.trim() : null,
      verifyToken,
    },
  })

  // Send verification email
  const verifyUrl = PORTAL + '/api/partner-signup/verify?token=' + verifyToken

  await sendEmail({
    to: email,
    subject: 'Verify your BespoxAI Partner account',
    html: `
      <div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1a2a1e">
        <div style="background:#040E09;padding:22px 28px;border-radius:12px 12px 0 0">
          <span style="font-size:20px;font-weight:700;color:#F4EFE4">Bespox<span style="color:#C8952A">AI</span></span>
        </div>
        <div style="background:#f7f5f0;padding:28px 32px;border-radius:0 0 12px 12px;border:1px solid #e8e4dc;border-top:none;line-height:1.7;font-size:14px;color:#2a3a2e">
          <p>Hi ${contactName},</p>
          <p>Thanks for applying to become a BespoxAI Partner. Please verify your email address to complete your application.</p>
          <p style="margin:20px 0">
            <a href="${verifyUrl}" style="background:#0A5C46;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
              Verify email address
            </a>
          </p>
          <p style="font-size:12px;color:#888">If you did not request this, you can safely ignore this email.</p>
          <p style="margin-top:28px;font-size:11px;color:#aaa;border-top:1px solid #e0dbd4;padding-top:14px">
            BespoxAI — automated notification.
          </p>
        </div>
      </div>
    `,
  }).catch(e => console.error('[partner-signup] verify email failed:', e))

  return NextResponse.json({ ok: true })
}
