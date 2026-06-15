import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

function superadminGuard(session: any) {
  if (!session?.user || !['superadmin', 'developer'].includes((session.user as any).role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return null
}

// GET /api/admin/requirements — all requirements across all tenants
// Superadmin: sees all. Developer: sees unassigned + assigned to them.
export async function GET() {
  const session = await getServerSession(authOptions)
  const guard = superadminGuard(session)
  if (guard) return guard

  const role   = (session!.user as any).role
  const userId = (session!.user as any).id

  try {
    const where = role === 'developer'
      ? { OR: [{ assignedDeveloperId: null }, { assignedDeveloperId: userId }] }
      : {}

    const requirements = await prisma.requirement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user:              { select: { name: true, email: true } },
        tenant:            { select: { name: true, partnerAccountId: true } },
        assignedDeveloper: { select: { id: true, name: true, email: true } },
        addenda: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, title: true, status: true, quote: true, createdAt: true, parentId: true },
        },
      },
    })

    // Separate top-level from addenda (admin sees both but addenda are nested)
    const topLevel = requirements.filter((r: any) => !r.parentId)
    const allAddenda = requirements.filter((r: any) => !!r.parentId)

    const statusCounts = topLevel.reduce((acc: Record<string, number>, r: any) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1
      return acc
    }, {})

    return NextResponse.json({ requirements: topLevel, allAddenda, statusCounts })
  } catch (err: any) {
    console.error('[admin/requirements] DB error:', err?.message)
    return NextResponse.json({ error: 'Database error — schema may need migration. Run: npx prisma db push', details: err?.message }, { status: 500 })
  }
}
