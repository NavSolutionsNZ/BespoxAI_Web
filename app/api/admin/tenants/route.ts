import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

function adminGuard(session: any) {
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return null
}

// GET /api/admin/tenants — list all tenants with user + query counts
export async function GET() {
  const session = await getServerSession(authOptions)
  const guard = adminGuard(session)
  if (guard) return guard

  const tenants = await (prisma as any).tenant.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      _count: { select: { users: true, queryLogs: true, requirements: true } },
      queryLogs: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
      partnerAccount: { select: { id: true, name: true, slug: true } },
    },
  })

  return NextResponse.json({ tenants })
}

// POST /api/admin/tenants — create a new tenant
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const guard = adminGuard(session)
  if (guard) return guard

  const body = await req.json().catch(() => ({}))
  const { name, tunnelSubdomain, bcInstance, bcCompany } = body

  if (!name || !tunnelSubdomain) {
    return NextResponse.json({ error: 'name and tunnelSubdomain are required' }, { status: 400 })
  }

  // Generate a secure API key
  const apiKey = crypto.randomBytes(32).toString('base64')

  try {
    const tenant = await prisma.tenant.create({
      data: {
        name:             name.trim(),
        tunnelSubdomain:  tunnelSubdomain.trim().toLowerCase(),
        bcInstance:       (bcInstance ?? 'GWM_Dev').trim(),
        bcCompany:        (bcCompany   ?? 'GWM').trim(),
        apiKey,
      },
    })
    return NextResponse.json({ tenant, apiKey })
  } catch (e: any) {
    if (e.code === 'P2002') {
      return NextResponse.json({ error: 'Tunnel subdomain already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
