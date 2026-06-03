import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerSession, assertTenantBelongsToPartner } from '@/lib/partner-auth'
import { prisma } from '@/lib/db'
import { notifyAdminsNewRequirement } from '@/lib/notifications'

export const dynamic = 'force-dynamic'

// GET /api/partner/tenants/[id]/requirements
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await requirePartnerSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await assertTenantBelongsToPartner(params.id, session.partnerAccountId)
  } catch {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const requirements = await (prisma as any).requirement.findMany({
    where:   { tenantId: params.id },
    orderBy: { createdAt: 'desc' },
    include: {
      user:   { select: { name: true, email: true } },
      tenant: { select: { name: true, country: true, paymentTermsKey: true } },
      addenda: {
        orderBy: { createdAt: 'asc' },
        select:  { id: true, title: true, status: true, quote: true, createdAt: true, parentId: true },
      },
    },
  })

  // Strip devPlan (superadmin-only)
  const sanitised = requirements.map(({ devPlan, ...rest }: any) => rest)
  return NextResponse.json({ requirements: sanitised })
}

// POST /api/partner/tenants/[id]/requirements — raise on behalf of tenant
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await requirePartnerSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await assertTenantBelongsToPartner(params.id, session.partnerAccountId)
  } catch {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const body = await req.json()
  const { title, description, bcArea, priority } = body

  if (!title?.trim() || !description?.trim() || !bcArea || !priority) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const tenant = await (prisma as any).tenant.findUnique({
    where:  { id: params.id },
    select: { name: true, country: true, paymentTermsKey: true },
  })

  const requirement = await (prisma as any).requirement.create({
    data: {
      tenantId:    params.id,
      userId:      session.userId,
      title:       title.trim(),
      description: description.trim(),
      bcArea,
      priority,
      status:      'draft',
    },
    include: {
      user:   { select: { name: true, email: true } },
      tenant: { select: { name: true, country: true, paymentTermsKey: true } },
      addenda: true,
    },
  })

  try {
    await notifyAdminsNewRequirement(requirement.id, requirement.title, tenant?.name ?? 'Unknown')
  } catch { /* non-fatal */ }

  return NextResponse.json(requirement, { status: 201 })
}
