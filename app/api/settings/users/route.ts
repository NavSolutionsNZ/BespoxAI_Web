import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { notifyUserWelcome } from '@/lib/notifications'

export const dynamic = 'force-dynamic'

function isTenantAdmin(role: string) { return role === 'tenant_admin' || role === 'superadmin' }

// GET /api/settings/users — list users for this tenant
export async function GET() {
  const session = await getServerSession(authOptions)
  const role = (session?.user as any)?.role
  if (!session?.user || !isTenantAdmin(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
  const session = await getServerSession(authOptions)
  const role = (session?.user as any)?.role
  if (!session?.user || !isTenantAdmin(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { email, name, userRole = 'user' } = body
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })
  if (!['user', 'tenant_admin', 'developer'].includes(userRole)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })

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
