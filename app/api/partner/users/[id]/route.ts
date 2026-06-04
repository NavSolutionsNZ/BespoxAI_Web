import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerSession }     from '@/lib/partner-auth'
import { prisma }                    from '@/lib/db'

// PATCH /api/partner/users/[id] — change role (admin only)
// [id] is the PartnerUser.id (not the User.id)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await requirePartnerSession('partner_admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { role } = body

  const validRoles = ['partner_admin', 'partner_developer']
  if (!validRoles.includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  const member = await (prisma as any).partnerUser.findUnique({
    where: { id: params.id },
  })

  if (!member || member.partnerAccountId !== session.partnerAccountId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Prevent removing the last admin
  if (member.role === 'partner_admin' && role !== 'partner_admin') {
    const adminCount = await (prisma as any).partnerUser.count({
      where: { partnerAccountId: session.partnerAccountId, role: 'partner_admin' },
    })
    if (adminCount <= 1) {
      return NextResponse.json({ error: 'Cannot demote the last admin' }, { status: 400 })
    }
  }

  const updated = await (prisma as any).partnerUser.update({
    where: { id: params.id },
    data:  { role },
  })

  return NextResponse.json({ ok: true, role: updated.role })
}

// DELETE /api/partner/users/[id] — remove team member (admin only)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await requirePartnerSession('partner_admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const member = await (prisma as any).partnerUser.findUnique({
    where: { id: params.id },
  })

  if (!member || member.partnerAccountId !== session.partnerAccountId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Prevent removing the last admin
  if (member.role === 'partner_admin') {
    const adminCount = await (prisma as any).partnerUser.count({
      where: { partnerAccountId: session.partnerAccountId, role: 'partner_admin' },
    })
    if (adminCount <= 1) {
      return NextResponse.json({ error: 'Cannot remove the last admin' }, { status: 400 })
    }
  }

  await (prisma as any).partnerUser.delete({ where: { id: params.id } })

  return NextResponse.json({ ok: true })
}
