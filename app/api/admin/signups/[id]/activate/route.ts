import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { sendWelcomeEmail } from '@/lib/email'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const signup = await prisma.signupRequest.findUnique({ where: { id: params.id } })
  if (!signup) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!signup.verifiedAt) return NextResponse.json({ error: 'Email not yet verified' }, { status: 400 })
  if (signup.activatedAt) return NextResponse.json({ error: 'Already activated' }, { status: 409 })

  const body = await req.json().catch(() => ({}))

  // Guard: check for existing user with this email
  const existingUser = await prisma.user.findUnique({ where: { email: signup.email } })
  if (existingUser)
    return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 })

  // Use provided subdomain or derive from company name
  const subdomain = (body.subdomain ?? signup.companyName)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 20)

  // Generate temp password
  const tempPassword = crypto.randomBytes(6).toString('hex') // e.g. "a3f8b2c1d4e5"
  const hashedPw     = await bcrypt.hash(tempPassword, 12)
  const apiKey       = crypto.randomBytes(24).toString('hex')

  // Create tenant + admin user in a transaction
  const { tenant, user } = await prisma.$transaction(async tx => {
    const tenant = await tx.tenant.create({
      data: {
        name:           signup.companyName,
        tunnelSubdomain: subdomain,
        bcInstance:     body.bcInstance ?? 'BC',
        bcCompany:      body.bcCompany  ?? signup.companyName,
        apiKey,
        country:        signup.country,
        tier:           'trial',
        trialEndsAt:    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        active:         true,
      },
    })

    const user = await tx.user.create({
      data: {
        email:    signup.email,
        name:     null,  // user sets their own name during onboarding
        password: hashedPw,
        role:     'tenant_admin',
        tenantId: tenant.id,
        active:   true,
      },
    })

    await tx.signupRequest.update({
      where: { id: params.id },
      data:  { activatedAt: new Date() },
    })

    return { tenant, user }
  })

  // Send welcome email with temp password
  await sendWelcomeEmail(signup.email, signup.companyName, tempPassword)

  return NextResponse.json({
    ok: true,
    tenantId: tenant.id,
    userId:   user.id,
    subdomain,
  })
}
