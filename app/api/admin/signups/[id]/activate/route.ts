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

  let tenant: any
  let user: any

  try {
    // Create tenant + admin user in a transaction
    ;({ tenant, user } = await prisma.$transaction(async tx => {
      const tenant = await tx.tenant.create({
        data: {
          name:           signup.companyName,
          tunnelSubdomain: subdomain,
          bcInstance:     body.bcInstance ?? 'BC',
          // Don't default to the portal org name — the BC/NAV company is a
          // separate, often different value the customer sets during onboarding.
          // `bcCompany` is a required (non-nullable) column with its own schema
          // default, so omit the key entirely when not provided rather than
          // passing null — Prisma rejects an explicit null for a required field.
          ...(body.bcCompany ? { bcCompany: body.bcCompany } : {}),
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
    }))
  } catch (e: any) {
    // Unique constraint on tunnelSubdomain — most likely an orphaned tenant from
    // a prior test/cleanup still holding the derived subdomain. Give the admin
    // an actionable message instead of an opaque 500 (which the activate button
    // can't recover from — see app/admin/page.tsx activate handler).
    if (e.code === 'P2002' && e.meta?.target?.includes?.('tunnelSubdomain')) {
      return NextResponse.json({
        error: `Subdomain "${subdomain}" is already in use by another tenant. ` +
               `Pass a different { subdomain } in the request body, or free up the existing one first.`,
      }, { status: 409 })
    }
    console.error('[admin/signups/activate] failed:', e)
    return NextResponse.json({ error: e.message ?? 'Activation failed' }, { status: 500 })
  }

  // Send welcome email with temp password. Activation already succeeded at this
  // point — an email failure shouldn't undo it or strand the admin on a dead
  // button, so it's logged rather than thrown.
  try {
    await sendWelcomeEmail(signup.email, signup.companyName, tempPassword)
  } catch (e: any) {
    console.error('[admin/signups/activate] tenant/user created but welcome email failed:', e)
    return NextResponse.json({
      ok: true,
      tenantId: tenant.id,
      userId:   user.id,
      subdomain,
      emailFailed: true,
    })
  }

  return NextResponse.json({
    ok: true,
    tenantId: tenant.id,
    userId:   user.id,
    subdomain,
  })
}
