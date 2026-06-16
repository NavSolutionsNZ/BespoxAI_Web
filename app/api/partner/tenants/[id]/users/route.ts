import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerSession, assertTenantBelongsToPartner } from '@/lib/partner-auth'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { notifyUserWelcome } from '@/lib/notifications'

export const dynamic = 'force-dynamic'

// GET /api/partner/tenants/[id]/users — list client-tenant users for this partner's tenant
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await requirePartnerSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await assertTenantBelongsToPartner(params.id, session.partnerAccountId)
  } catch {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const users = await (prisma as any).user.findMany({
    where:  { tenantId: params.id },
    select: { id: true, name: true, email: true, role: true, active: true, createdAt: true, lastSignInAt: true },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({ users })
}

// POST /api/partner/tenants/[id]/users — partner_admin invites a CLIENT login user
// Mirrors the direct /api/settings/users invite, with partner auth + tenant ownership.
// Client users are tenant_admin | user only — never developer/partner roles.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await requirePartnerSession('partner_admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await assertTenantBelongsToPartner(params.id, session.partnerAccountId)
  } catch {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const { email, name, userRole = 'tenant_admin' } = body
  if (!email?.trim()) return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  if (!['tenant_admin', 'user'].includes(userRole)) {
    return NextResponse.json({ error: 'Client users can only be Administrator or User' }, { status: 400 })
  }

  const normEmail = email.trim().toLowerCase()
  const existing = await (prisma as any).user.findUnique({ where: { email: normEmail } })
  if (existing) return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 })

  const tempPassword = crypto.randomBytes(5).toString('hex')
  const hashed = await bcrypt.hash(tempPassword, 12)

  const user = await (prisma as any).user.create({
    data: {
      email:              normEmail,
      name:               name?.trim() || null,
      password:           hashed,
      role:               userRole,
      tenantId:           params.id,
      active:             true,
      onboardingDone:     false,
      mustChangePassword: true,
    },
    select: { id: true, name: true, email: true, role: true, active: true, createdAt: true, lastSignInAt: true },
  })

  const tenant = await (prisma as any).tenant.findUnique({ where: { id: params.id }, select: { name: true } })

  // Welcome email — notifyUserWelcome resolves the partner's white-label brand +
  // from-address from tenantId, so a white-label partner's client gets a branded email.
  notifyUserWelcome({
    tenantId:     params.id,
    to:           normEmail,
    name:         name?.trim() || null,
    tempPassword,
    tenantName:   tenant?.name ?? '',
    role:         userRole as 'tenant_admin' | 'user',
  })

  return NextResponse.json({ user, tempPassword }, { status: 201 })
}
