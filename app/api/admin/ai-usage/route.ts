/**
 * GET /api/admin/ai-usage
 *
 * Returns AI token usage stats for the superadmin AI Setup tab.
 * Provides: this-month totals, per-tenant breakdown, per-feature breakdown,
 * and estimated USD cost. Superadmin only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { estimateCost } from '@/lib/ai-usage'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const now       = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)

  try {
    // All-time totals
    const allTime = await (prisma as any).aiUsageLog.aggregate({
      _sum: { inputTokens: true, outputTokens: true },
    })

    // This month totals
    const thisMonth = await (prisma as any).aiUsageLog.aggregate({
      where: { createdAt: { gte: monthStart } },
      _sum: { inputTokens: true, outputTokens: true },
      _count: true,
    })

    // Last month totals (for delta)
    const lastMonth = await (prisma as any).aiUsageLog.aggregate({
      where: { createdAt: { gte: lastMonthStart, lt: monthStart } },
      _sum: { inputTokens: true, outputTokens: true },
    })

    // Per-tenant breakdown this month
    const byTenantRaw = await (prisma as any).aiUsageLog.groupBy({
      by: ['tenantId'],
      where: { createdAt: { gte: monthStart } },
      _sum: { inputTokens: true, outputTokens: true },
      _count: true,
      orderBy: { _sum: { outputTokens: 'desc' } },
    })

    // All-time per-tenant (for cumulative cost reconciliation)
    const byTenantAllTimeRaw = await (prisma as any).aiUsageLog.groupBy({
      by: ['tenantId'],
      _sum: { inputTokens: true, outputTokens: true },
      _count: true,
      orderBy: { _sum: { outputTokens: 'desc' } },
    })

    // Fetch tenant names (union of both sets)
    const tenantIds = [...new Set([
      ...byTenantRaw.map((r: any) => r.tenantId),
      ...byTenantAllTimeRaw.map((r: any) => r.tenantId),
    ])]
    const tenants = await (prisma as any).tenant.findMany({
      where: { id: { in: tenantIds } },
      select: { id: true, name: true },
    })
    const tenantMap: Record<string, string> = {}
    tenants.forEach((t: any) => { tenantMap[t.id] = t.name })

    const byTenant = byTenantRaw.map((r: any) => ({
      tenantId:     r.tenantId,
      tenantName:   tenantMap[r.tenantId] ?? r.tenantId,
      inputTokens:  r._sum.inputTokens  ?? 0,
      outputTokens: r._sum.outputTokens ?? 0,
      requests:     r._count,
      estimatedUsd: estimateCost('claude-sonnet-4-5', r._sum.inputTokens ?? 0, r._sum.outputTokens ?? 0),
    }))

    const byTenantAllTime = byTenantAllTimeRaw.map((r: any) => ({
      tenantId:     r.tenantId,
      tenantName:   tenantMap[r.tenantId] ?? r.tenantId,
      inputTokens:  r._sum.inputTokens  ?? 0,
      outputTokens: r._sum.outputTokens ?? 0,
      requests:     r._count,
      estimatedUsd: estimateCost('claude-sonnet-4-5', r._sum.inputTokens ?? 0, r._sum.outputTokens ?? 0),
    }))

    // Per-feature breakdown this month
    const byFeatureRaw = await (prisma as any).aiUsageLog.groupBy({
      by: ['feature'],
      where: { createdAt: { gte: monthStart } },
      _sum: { inputTokens: true, outputTokens: true },
      _count: true,
    })

    const byFeature = byFeatureRaw.map((r: any) => ({
      feature:      r.feature,
      inputTokens:  r._sum.inputTokens  ?? 0,
      outputTokens: r._sum.outputTokens ?? 0,
      requests:     r._count,
    }))

    // Recent log (last 20 entries)
    const recent = await (prisma as any).aiUsageLog.findMany({
      take:    20,
      orderBy: { createdAt: 'desc' },
      include: { tenant: { select: { name: true } } },
    })

    const allTimeIn  = allTime._sum.inputTokens  ?? 0
    const allTimeOut = allTime._sum.outputTokens ?? 0
    const thisMonthIn  = thisMonth._sum.inputTokens  ?? 0
    const thisMonthOut = thisMonth._sum.outputTokens ?? 0
    const lastMonthIn  = lastMonth._sum.inputTokens  ?? 0
    const lastMonthOut = lastMonth._sum.outputTokens ?? 0

    return NextResponse.json({
      allTime: {
        inputTokens:  allTimeIn,
        outputTokens: allTimeOut,
        estimatedUsd: estimateCost('claude-sonnet-4-5', allTimeIn, allTimeOut),
      },
      thisMonth: {
        inputTokens:  thisMonthIn,
        outputTokens: thisMonthOut,
        requests:     thisMonth._count,
        estimatedUsd: estimateCost('claude-sonnet-4-5', thisMonthIn, thisMonthOut),
      },
      lastMonth: {
        inputTokens:  lastMonthIn,
        outputTokens: lastMonthOut,
        estimatedUsd: estimateCost('claude-sonnet-4-5', lastMonthIn, lastMonthOut),
      },
      byTenant,
      byTenantAllTime,
      byFeature,
      recent: recent.map((r: any) => ({
        id:            r.id,
        tenantName:    r.tenant?.name ?? r.tenantId,
        feature:       r.feature,
        model:         r.model,
        inputTokens:   r.inputTokens,
        outputTokens:  r.outputTokens,
        estimatedUsd:  estimateCost(r.model, r.inputTokens, r.outputTokens),
        createdAt:     r.createdAt,
      })),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
