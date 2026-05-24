import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { notifyUserWelcome } from '@/lib/notifications'

export const dynamic = 'force-dynamic'

function isTenantAdmin(role: string) { return role === 'tenant_admin' || role === 'superadmin' }

// ── DEBUG MODE ────────────────────────────────────────────────────────────────
const DEBUG = process.env.SETTINGS_DEBUG === 'true'
const DEBUG_USERS = [
  { id: 'debug-u1', name: 'Jane Smith',  email: 'jane@demo.com',  role: 'tenant_admin', active: true,  createdAt: '2026-01-15T00:00:00Z' },
  { id: 'debug-u2', name: 'Bob Jones',   email: 'bob@demo.com',   role: 'user',         active: true,  createdAt: '2026-02-01T00:00:00Z' },
  { id: 'debug-u3', name: 'Alice Brown', email: 'alice@demo.com', role: 'user',         active: false, createdAt: '2026-03-10T00:00:00Z' },
]
// ── END DEBUG ─────────────────────────────────────────────────────────────────

// GET /api/settings/users — list users for this tenant
export async function GET() {
  const session = await getServerSession(authOptions)
  const role = (session?.user as any)?.role
  if (!session?.user || !isTenantAdmin(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // ── DEBUG ──
  if (DEBUG) return NextResponse.json({ users: DEBUG_USERS })
  // ── END DEBUG ──

  const tenantId = (session.user as any).tenantId
  const users = await prisma.user.findMany({
    where: { tenantId },
    select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
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

  // ── DEBUG ──
  if (DEBUG) return NextResponse.json({
    user: { id: `debug-u${Date.now()}`, name: name || null, email, role: userRole, active: true, createdAt: new Date().toISOString() },
    tempPassword: 'debug-pass-1234',
    _debug: true,
  })
  // ── END DEBUG ──

  const tenantId = (session.user as any).tenantId
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 })

  const tempPassword = crypto.randomBytes(5).toString('hex')
  const hashed = await bcrypt.hash(tempPassword, 12)

  const user = await prisma.user.create({
    data: { email, name: name || null, password: hashed, role: userRole, tenantId, active: true, onboardingDone: false, mustChangePassword: true },
    select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
  })

  // Get tenant name for the email
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } })
  notifyUserWelcome({
    to:           email,
    name:         name || null,
    tempPassword,
    tenantName:   tenant?.name ?? '',
    role:         userRole as any,
  })

  return NextResponse.json({ user, tempPassword })
}
