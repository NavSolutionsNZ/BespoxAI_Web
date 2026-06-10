import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { notifyPartnerWelcome } from '@/lib/notifications'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

// POST /api/admin/partners/[id]/resend-welcome
// Generates a fresh temp password for the partner's admin user, re-hashes it,
// and re-sends the welcome email. The original temp password is unrecoverable
// (hashed at activation), so a new one is issued.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if ((session?.user as any)?.role !== 'superadmin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const partner = await (prisma as any).partnerAccount.findUnique({
    where: { id: params.id },
  })
  if (!partner) return NextResponse.json({ error: 'Partner not found' }, { status: 404 })

  // Find the partner_admin user for this account
  const partnerUser = await (prisma as any).partnerUser.findFirst({
    where: { partnerAccountId: params.id, role: 'partner_admin' },
    include: { user: true },
  })
  if (!partnerUser?.user) {
    return NextResponse.json({ error: 'No partner admin user found for this account' }, { status: 404 })
  }

  const user = partnerUser.user

  // Generate a fresh temp password, re-hash onto the user, force change on next login
  const tempPassword = crypto.randomBytes(5).toString('hex')
  const hashed = await bcrypt.hash(tempPassword, 12)

  await (prisma as any).user.update({
    where: { id: user.id },
    data:  { password: hashed, mustChangePassword: true },
  })

  // Send welcome email with the new credentials
  try {
    await notifyPartnerWelcome({
      email:        user.email,
      contactName:  user.name ?? partner.contactName ?? user.email,
      companyName:  partner.name,
      tempPassword,
    })
  } catch (e) {
    console.error('[partner-resend-welcome] email failed:', e)
    return NextResponse.json({ error: 'Password reset, but welcome email failed to send' }, { status: 502 })
  }

  return NextResponse.json({ ok: true, email: user.email })
}
