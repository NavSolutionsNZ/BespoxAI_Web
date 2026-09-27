import { NextRequest, NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/api-auth'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { notifyUserWelcome } from '@/lib/notifications'

export const dynamic = 'force-dynamic'

// GET /api/settings/users — list users for this tenant
export async function GET() {
  const session = await requireTenantAdmin()
  if (session instanceof NextResponse) return session

  const tenantId = (session.user as any).tenantId
  const users = await prisma.user.findMany({
    where: { tenantId },
    select: { id: true, name: true, email: true, role: true, active: true, createdAt: true, lastSignInAt: true },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({ users })
}

// POST /api/settings/users — invite a new user
export async function POST(req: NextRequest) {
  const session = await requireTenantAdmin()
  if (session instanceof NextResponse) return session

  const body = await req.json().catch(() => ({}))
  const { email, name, userRole = 'user' } = body
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })
  // Customers can add their own staff only. 'developer' is an internal BespoxAI
  // role with cross-tenant access (admin requirements, coding assistant, RDP).
  if (!['user', 'tenant_admin'].includes(userRole)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })

  const tenantId = (session.user as any).tenantId
  const existing = await (prisma as any).user.findUnique({ where: { email } })
  if (existing) return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 })

  const tempPassword = crypto.randomBytes(5).toString('hex')
  const hashed = await bcrypt.hash(tempPassword, 12)

  const user = await (prisma as any).user.create({
    data: { email, name: name || null, password: hashed, role: userRole, tenantId, active: true, onboardingDone: false, mustChangePassword: true },
    select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
  })

  // Get tenant name for the email
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } })
  notifyUserWelcome({
    tenantId: user.tenantId,
    to:           email,
    name:         name || null,
    tempPassword,
    tenantName:   tenant?.name ?? '',
    role:         userRole as any,
  })

  return NextResponse.json({ user, tempPassword })
}
