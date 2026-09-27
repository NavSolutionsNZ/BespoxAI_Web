import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerSession }     from '@/lib/partner-auth'
import { prisma }                    from '@/lib/db'
import crypto                        from 'crypto'
import bcrypt                        from 'bcryptjs'

// GET /api/partner/users — list all team members for this partner account
export async function GET(_req: NextRequest) {
  const session = await requirePartnerSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const members = await (prisma as any).partnerUser.findMany({
    where:   { partnerAccountId: session.partnerAccountId },
    include: {
      user: {
        select: {
          id:        true,
          email:     true,
          firstName: true,
          lastName:  true,
          preferredName: true,
          createdAt: true,
          lastSignInAt: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json(members.map((m: any) => ({
    id:        m.id,
    role:      m.role,
    createdAt: m.createdAt,
    user: {
      id:        m.user.id,
      email:     m.user.email,
      name:      m.user.preferredName ?? m.user.firstName ?? m.user.email,
      firstName: m.user.firstName,
      lastName:  m.user.lastName,
      lastSignInAt: m.user.lastSignInAt,
    },
  })))
}

// POST /api/partner/users — invite a new team member (admin only)
export async function POST(req: NextRequest) {
  const session = await requirePartnerSession('partner_admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { email, firstName, lastName, role } = body

  if (!email?.trim()) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }

  const validRoles = ['partner_admin', 'partner_developer']
  if (!validRoles.includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  // Check not already a user
  const existing = await (prisma as any).user.findUnique({
    where:  { email: email.trim().toLowerCase() },
    select: { id: true },
  })

  if (existing) {
    // Never attach an existing account. Linking made the account a member of
    // this partner with no consent from its owner, which also stripped a
    // customer user of their tenant at next sign-in (partner sessions carry no
    // tenantId) and could be pointed at any account, including BespoxAI staff.
    // Moving an existing person onto a partner team is a BespoxAI admin task.
    return NextResponse.json(
      { error: 'An account with this email already exists. Contact BespoxAI support to add it to your team.' },
      { status: 409 },
    )
  }

  // New user — generate temp password
  const tempPassword = crypto.randomBytes(6).toString('hex')
  const hashed       = await bcrypt.hash(tempPassword, 12)

  const partner = await (prisma as any).partnerAccount.findUnique({
    where:  { id: session.partnerAccountId },
    select: { name: true, isWhiteLabel: true, brandName: true, fromEmail: true },
  })

  const user = await (prisma as any).user.create({
    data: {
      email:             email.trim().toLowerCase(),
      name:              [firstName, lastName].filter(Boolean).join(' ') || email,
      firstName:         firstName?.trim() || null,
      lastName:          lastName?.trim()  || null,
      password:          hashed,
      role:              'user',
      mustChangePassword: true,
      active:            true,
      onboardingDone:    true,   // partner users skip tenant onboarding
      partnerUsers: {
        create: {
          partnerAccountId: session.partnerAccountId,
          role,
        },
      },
    },
  })

  // Send welcome email
  try {
    const { notifyPartnerTeamWelcome } = await import('@/lib/notifications')
    await notifyPartnerTeamWelcome({
      to:           email.trim().toLowerCase(),
      firstName:    firstName?.trim() || null,
      partnerName:  partner?.name ?? 'your partner account',
      role,
      tempPassword,
      fromEmail:    (partner?.isWhiteLabel && partner?.fromEmail) ? partner.fromEmail : null,
    })
  } catch (e) {
    console.error('[partner/users] welcome email failed:', e)
  }

  return NextResponse.json({ ok: true, userId: user.id }, { status: 201 })
}
