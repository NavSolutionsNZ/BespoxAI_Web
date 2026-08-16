import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { unstable_cache } from 'next/cache'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

function adminGuard(session: any) {
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return null
}

const getCachedUsers = unstable_cache(
  async () => {
    return await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id:        true,
        email:     true,
        name:      true,
        role:      true,
        active:    true,
        tenantId:  true,
        createdAt: true,
        lastSignInAt: true,
        tenant:    {
          select: {
            name: true,
            active: true,
            partnerAccount: { select: { name: true } },
          },
        },
        partnerUsers: {
          select: {
            role: true,
            partnerAccount: {
              select: {
                name: true,
              },
            },
          },
        },
        _count:    { select: { queryLogs: true } },
      },
    })
  },
  ['admin-users'],
  { revalidate: 60 }
)

// GET /api/admin/users — list all users across all tenants
export async function GET() {
  const session = await getServerSession(authOptions)
  const guard = adminGuard(session)
  if (guard) return guard

  const users = await getCachedUsers()
  return NextResponse.json({ users })
}

// POST /api/admin/users — create/invite a user, returns generated password
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const guard = adminGuard(session)
  if (guard) return guard

  const body = await req.json().catch(() => ({}))
  const { email, name, role, tenantId } = body

  if (!email || !tenantId) {
    return NextResponse.json({ error: 'email and tenantId are required' }, { status: 400 })
  }

  // Generate a readable temporary password
  const tempPassword = crypto.randomBytes(6).toString('hex').toUpperCase().slice(0, 12)
  const hashed = await bcrypt.hash(tempPassword, 12)

  try {
    const user = await prisma.user.create({
      data: {
        email:    email.trim().toLowerCase(),
        name:     name?.trim() ?? '',
        role:     role === 'tenant_admin' ? 'tenant_admin' : 'user',
        password: hashed,
        tenantId,
        mustChangePassword: true,
      } as any,
      select: { id: true, email: true, name: true, role: true, tenantId: true, createdAt: true },
    })
    // Return temp password once — not stored in plaintext
    return NextResponse.json({ user, tempPassword })
  } catch (e: any) {
    if (e.code === 'P2002') {
      return NextResponse.json({ error: 'Email already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
