import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { unstable_cache } from 'next/cache'

export const dynamic = 'force-dynamic'

const getCachedStats = unstable_cache(
  async () => {
    const [totalQueries, todayQueries, tenants, topEntities] = await Promise.all([
      // Total queries ever
      prisma.queryLog.count(),

      // Queries in last 24h
      prisma.queryLog.count({
        where: { createdAt: { gte: new Date(Date.now() - 86_400_000) } },
      }),

      // Per-tenant: name, query count, last query
      prisma.tenant.findMany({
        select: {
          id:   true,
          name: true,
          active: true,
          tier: true,
          trialEndsAt: true,
          _count: { select: { queryLogs: true, users: true } },
          queryLogs: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { createdAt: true, question: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),

      // Top 5 most queried entities
      prisma.queryLog.groupBy({
        by: ['entity'],
        _count: { entity: true },
        orderBy: { _count: { entity: 'desc' } },
        take: 5,
        where: { entity: { not: null } },
      }),
    ])

    return { totalQueries, todayQueries, tenants, topEntities }
  },
  ['admin-stats'],
  { revalidate: 60 }
)

// GET /api/admin/stats — query usage stats per tenant
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const stats = await getCachedStats()
  return NextResponse.json(stats)
}
