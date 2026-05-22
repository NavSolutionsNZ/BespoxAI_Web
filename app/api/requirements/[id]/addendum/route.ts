/**
 * POST /api/requirements/[id]/addendum
 *
 * Creates a child (addendum) requirement linked to an existing parent.
 * Customer-facing — only the tenant owner of the parent can add addenda.
 * Parent must be in a post-quote stage (in_development or later) to warrant an addendum.
 *
 * Body: { title, description, bcArea, priority }
 * Returns: the created addendum requirement
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { prisma }                    from '@/lib/db'
import { notifyAdminsNewRequirement } from '@/lib/notifications'

export const dynamic = 'force-dynamic'

const ADDENDUM_ALLOWED_STATUSES = [
  'deposit_paid',
  'in_development',
]

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user       = session.user as any
  const parentId   = params.id

  // Load the parent
  const parent = await (prisma as any).requirement.findUnique({
    where:   { id: parentId },
    include: { tenant: true },
  })
  if (!parent) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Must belong to the same tenant
  if (parent.tenantId !== user.tenantId)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Parent must be far enough along
  if (!ADDENDUM_ALLOWED_STATUSES.includes(parent.status))
    return NextResponse.json(
      { error: `Addenda can only be added to requirements that are in development or later (current status: ${parent.status})` },
      { status: 400 },
    )

  const { title, description, bcArea, priority } = await req.json()

  if (!title?.trim())       return NextResponse.json({ error: 'Title is required' },       { status: 400 })
  if (!description?.trim()) return NextResponse.json({ error: 'Description is required' }, { status: 400 })
  if (!bcArea?.trim())      return NextResponse.json({ error: 'BC Area is required' },     { status: 400 })
  if (!priority?.trim())    return NextResponse.json({ error: 'Priority is required' },    { status: 400 })

  const addendum = await (prisma as any).requirement.create({
    data: {
      tenantId:    parent.tenantId,
      userId:      user.id,
      parentId,
      title:       title.trim(),
      description: description.trim(),
      bcArea,
      priority,
      status:      'submitted',   // skip draft — go straight to submitted
    },
    include: {
      user:   { select: { name: true, email: true } },
      tenant: { select: { name: true, country: true, paymentTermsKey: true } },
      addenda: true,
    },
  })

  // Notify superadmins — fire and forget
  notifyAdminsNewRequirement({
    requirementId: addendum.id,
    title:         addendum.title,
    tenantName:    (addendum as any).tenant?.name ?? '',
    customerName:  (addendum as any).user?.name ?? (addendum as any).user?.email ?? '',
    customerEmail: (addendum as any).user?.email ?? '',
    isAddendum:    true,
    parentTitle:   parent.title,
  })

  return NextResponse.json({ requirement: addendum }, { status: 201 })
}
