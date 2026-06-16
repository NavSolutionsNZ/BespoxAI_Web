import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerSession, assertTenantBelongsToPartner } from '@/lib/partner-auth'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { notifyUserWelcome } from '@/lib/notifications'

export const dynamic = 'force-dynamic'

// PATCH /api/partner/tenants/[id]/users/[userId] — enable | disable | resend
// Resend = new temp password + re-send the branded welcome email.
export async function PATCH(req: NextRequest, { params }: { params: { id: string; userId: string } }) {
  const session = await requirePartnerSession('partner_admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await assertTenantBelongsToPartner(params.id, session.partnerAccountId)
  } catch {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const action = body.action as string
  if (!['enable', 'disable', 'resend', 'reset'].includes(action))
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  // Target must be a user of THIS tenant (prevents touching users on other tenants)
  const target = await (prisma as any).user.findFirst({ where: { id: params.userId, tenantId: params.id } })
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // Self-action guard
  if (target.id === session.userId && action === 'disable')
    return NextResponse.json({ error: 'You cannot deactivate your own account' }, { status: 400 })

  if (action === 'enable') {
    await (prisma as any).user.update({ where: { id: target.id }, data: { active: true } })
    return NextResponse.json({ ok: true })
  }

  if (action === 'disable') {
    await (prisma as any).user.update({ where: { id: target.id }, data: { active: false } })
    return NextResponse.json({ ok: true })
  }

  if (action === 'reset') {
    // Reset password ONLY — no email. Returns the temp password for the partner to relay.
    const tempPassword = crypto.randomBytes(5).toString('hex')
    const hashed = await bcrypt.hash(tempPassword, 12)
    await (prisma as any).user.update({
      where: { id: target.id },
      data:  { password: hashed, mustChangePassword: true },
    })
    return NextResponse.json({ ok: true, tempPassword })
  }

  // resend: new temp password + force change + branded welcome email
  const tempPassword = crypto.randomBytes(5).toString('hex')
  const hashed = await bcrypt.hash(tempPassword, 12)
  await (prisma as any).user.update({
    where: { id: target.id },
    data:  { password: hashed, mustChangePassword: true, active: true },
  })

  const tenant = await (prisma as any).tenant.findUnique({ where: { id: params.id }, select: { name: true } })
  notifyUserWelcome({
    tenantId:     params.id,
    to:           target.email,
    name:         target.name ?? null,
    tempPassword,
    tenantName:   tenant?.name ?? '',
    role:         (target.role === 'tenant_admin' ? 'tenant_admin' : 'user'),
  })

  return NextResponse.json({ ok: true, tempPassword })
}

// DELETE /api/partner/tenants/[id]/users/[userId]
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; userId: string } }) {
  const session = await requirePartnerSession('partner_admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await assertTenantBelongsToPartner(params.id, session.partnerAccountId)
  } catch {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  if (params.userId === session.userId)
    return NextResponse.json({ error: 'You cannot remove your own account' }, { status: 400 })

  const target = await (prisma as any).user.findFirst({ where: { id: params.userId, tenantId: params.id } })
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  await (prisma as any).user.delete({ where: { id: target.id } })
  await (prisma as any).signupRequest.deleteMany({ where: { email: target.email } }).catch(() => {})

  return NextResponse.json({ ok: true })
}
