import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

function adminGuard(session: any) {
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return null
}

// PATCH /api/admin/users/[id]
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const guard = adminGuard(session)
  if (guard) return guard

  if ((session!.user as any).id === params.id)
    return NextResponse.json({ error: 'Cannot modify your own account' }, { status: 400 })

  const target = await prisma.user.findUnique({ where: { id: params.id }, select: { role: true, tenantId: true } })
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (target.role === 'superadmin')
    return NextResponse.json({ error: 'Cannot modify a superadmin account' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { active, role, resetPassword } = body

  const updateData: any = {}
  if (active !== undefined) updateData.active = active
  if (role   !== undefined) {
    const allowed = ['user', 'tenant_admin', 'developer']
    const requested = allowed.includes(role) ? role : 'user'
    // Customers (any user tied to a tenant) must never become developers — developers are internal staff
    if (requested === 'developer' && target.tenantId) {
      return NextResponse.json({ error: 'Customer users cannot be assigned the developer role' }, { status: 403 })
    }
    updateData.role = requested
  }

  let tempPassword: string | null = null
  if (resetPassword) {
    tempPassword = crypto.randomBytes(6).toString('hex').toUpperCase().slice(0, 12)
    updateData.password = await bcrypt.hash(tempPassword, 12)
    // Force the user to change this temp password on next login — same gap
    // as the other two temp-password paths (signup activation, admin create).
    updateData.mustChangePassword = true
  }

  const user = await prisma.user.update({
    where: { id: params.id },
    data:  updateData,
    select: { id: true, email: true, name: true, role: true, active: true, tenantId: true },
  })

  return NextResponse.json({ user, ...(tempPassword ? { tempPassword } : {}) })
}

// DELETE /api/admin/users/[id]
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const guard = adminGuard(session)
  if (guard) return guard

  if ((session!.user as any).id === params.id)
    return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })

  const targetDel = await prisma.user.findUnique({ where: { id: params.id }, select: { role: true, email: true } })
  if (!targetDel) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (targetDel.role === 'superadmin')
    return NextResponse.json({ error: 'Cannot delete a superadmin account' }, { status: 403 })

  try {
    const reqIds = (await prisma.requirement.findMany({
      where: { userId: params.id }, select: { id: true },
    })).map(r => r.id)

    if (reqIds.length > 0) {
      await prisma.aiUsageLog.deleteMany({ where: { requirementId: { in: reqIds } } })
    }

    await (prisma as any).tenantObjectFile.deleteMany({
      where: { OR: [{ uploadedById: params.id }, ...(reqIds.length > 0 ? [{ requirementId: { in: reqIds } }] : [])] },
    })

    await prisma.requirement.deleteMany({ where: { userId: params.id } })
    await prisma.migrationEnquiry.deleteMany({ where: { userId: params.id } })
    await prisma.queryLog.deleteMany({ where: { userId: params.id } })
    await prisma.account.deleteMany({ where: { userId: params.id } })
    await prisma.session.deleteMany({ where: { userId: params.id } })
    await prisma.user.delete({ where: { id: params.id } })

    // Clean up associated signup request
    if (targetDel.email) {
      await prisma.signupRequest.deleteMany({ where: { email: targetDel.email } }).catch(() => {})
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('[deleteUser]', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
