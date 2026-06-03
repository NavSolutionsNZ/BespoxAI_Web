import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { notifyPartnerWelcome } from '@/lib/notifications'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if ((session?.user as any)?.role !== 'superadmin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const signup = await (prisma as any).partnerSignupRequest.findUnique({
    where: { id: params.id },
  })

  if (!signup) return NextResponse.json({ error: 'Signup request not found' }, { status: 404 })
  if (!signup.verifiedAt) return NextResponse.json({ error: 'Email not yet verified' }, { status: 400 })
  if (signup.activatedAt) return NextResponse.json({ error: 'Already activated' }, { status: 409 })

  // Check slug still unique (may have been taken since signup)
  const slugTaken = await (prisma as any).partnerAccount.findUnique({ where: { slug: signup.slug } })
  if (slugTaken) {
    return NextResponse.json({ error: 'Slug ' + signup.slug + ' is already in use — edit the signup slug first' }, { status: 409 })
  }

  // Check email not already a user
  const emailTaken = await (prisma as any).user.findUnique({ where: { email: signup.email } })
  if (emailTaken) {
    return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 })
  }

  const tempPassword = crypto.randomBytes(5).toString('hex')
  const hashed = await bcrypt.hash(tempPassword, 12)

  // Create PartnerAccount
  const partner = await (prisma as any).partnerAccount.create({
    data: {
      id:                 crypto.randomUUID(),
      name:               signup.companyName,
      slug:               signup.slug,
      billingEmail:       signup.billingEmail,
      contactName:        signup.contactName,
      phone:              signup.phone,
      address:            signup.address,
      gstNumber:          signup.gstNumber,
      paymentMode:        signup.paymentMode,
      bankAccount:        signup.bankAccount,
      revenueSharePartner: 0.60,
      isActive:           true,
      updatedAt:          new Date(),
    },
  })

  // Create User — tenantId is now nullable; partner users have no tenant (context comes from PartnerUser)
  const user = await (prisma as any).user.create({
    data: {
      email:             signup.email,
      name:              signup.contactName,
      firstName:         signup.contactName.split(' ')[0] ?? signup.contactName,
      lastName:          signup.contactName.split(' ').slice(1).join(' ') || null,
      password:          hashed,
      role:              'user',
      mustChangePassword: true,
      onboardingDone:    true,
      active:            true,
      tenantId:          null,
    },
  })

  // Create PartnerUser linking user to partner account
  await (prisma as any).partnerUser.create({
    data: {
      id:               crypto.randomUUID(),
      partnerAccountId: partner.id,
      userId:           user.id,
      role:             'partner_admin',
    },
  })

  // Mark signup as activated
  await (prisma as any).partnerSignupRequest.update({
    where: { id: params.id },
    data:  { activatedAt: new Date() },
  })

  // Send welcome email
  notifyPartnerWelcome({
    email:       signup.email,
    contactName: signup.contactName,
    companyName: signup.companyName,
    tempPassword,
  }).catch(e => console.error('[partner-activate] welcome email failed:', e))

  return NextResponse.json({ ok: true, partnerAccountId: partner.id })
}
