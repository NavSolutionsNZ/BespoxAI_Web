import { prisma } from '@/lib/db'

export type TierStatus =
  | { allowed: true }
  | { allowed: false; reason: 'no_plan' | 'trial_expired' | 'no_tenant' | 'unknown'; trialEndsAt?: string | null }

// ── Monthly token allowances per tier ────────────────────────────────────────

export const TOKEN_LIMITS: Record<string, number> = {
  free:      0,
  trial:     50_000,
  starter:   50_000,
  assistant: 300_000,
  manager:   750_000,
  executive: 3_000_000,
  paid:      300_000,   // legacy
  enterprise:3_000_000, // legacy
}

export interface TokenLimitStatus {
  allowed:    boolean
  used:       number
  limit:      number
  tier:       string
  percentUsed: number
  warning:    boolean   // true when >= 80%
}

export async function getMonthlyTokenUsage(tenantId: string): Promise<number> {
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const result = await (prisma as any).aiUsageLog.aggregate({
    where: { tenantId, createdAt: { gte: monthStart } },
    _sum:  { inputTokens: true, outputTokens: true },
  })
  return (result._sum.inputTokens ?? 0) + (result._sum.outputTokens ?? 0)
}

export async function checkTokenLimit(tenantId: string): Promise<TokenLimitStatus> {
  const tenant = await prisma.tenant.findUnique({
    where:  { id: tenantId },
    select: { tier: true },
  })
  const tier  = tenant?.tier ?? 'free'
  const limit = TOKEN_LIMITS[tier] ?? 0

  if (limit === 0) return { allowed: false, used: 0, limit: 0, tier, percentUsed: 100, warning: true }

  const used       = await getMonthlyTokenUsage(tenantId)
  const percentUsed = Math.min(100, Math.round((used / limit) * 100))
  return { allowed: used < limit, used, limit, tier, percentUsed, warning: percentUsed >= 80 }
}


export async function checkTierAccess(tenantId: string): Promise<TierStatus> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { tier: true, trialEndsAt: true },
  })

  if (!tenant) return { allowed: false, reason: 'no_tenant' }

  // Paid subscription tiers — always allowed
  if (['assistant', 'manager', 'executive'].includes(tenant.tier)) {
    return { allowed: true }
  }

  // Legacy: paid / enterprise — always allowed
  if (tenant.tier === 'paid' || tenant.tier === 'enterprise') {
    return { allowed: true }
  }

  // Trial — check expiry
  if (tenant.tier === 'trial') {
    if (!tenant.trialEndsAt) return { allowed: true }
    if (new Date() < new Date(tenant.trialEndsAt)) return { allowed: true }
    return {
      allowed: false,
      reason: 'trial_expired',
      trialEndsAt: tenant.trialEndsAt.toISOString(),
    }
  }

  // Free tier — no assistant access
  if (tenant.tier === 'free') {
    return { allowed: false, reason: 'no_plan' }
  }

  return { allowed: false, reason: 'unknown' }
}

/**
 * Check if a tenant has access to a specific feature.
 * Extend this as new features are gated per plan.
 */
export async function checkFeatureAccess(
  tenantId: string,
  feature: 'assistant' | 'manager' | 'executive' | 'unlimited_specs' | 'agent'
): Promise<boolean> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { tier: true },
  })
  if (!tenant) return false
  const tier = tenant.tier

  switch (feature) {
    case 'assistant':
      // CFO Assistant: Assistant tier and above (Starter does NOT include this)
      return ['assistant', 'manager', 'executive', 'paid', 'enterprise', 'trial'].includes(tier)
    case 'manager':
      return ['manager', 'executive'].includes(tier)
    case 'executive':
      return tier === 'executive'
    case 'unlimited_specs':
      // Free tier gets 1 spec; Starter and above get unlimited
      return ['starter', 'assistant', 'manager', 'executive', 'paid', 'enterprise', 'trial'].includes(tier)
    case 'agent':
      // BespoxAI Agent (BCAgent) install + environment indexing: paid tiers and trial, not free
      return ['starter', 'assistant', 'manager', 'executive', 'paid', 'enterprise', 'trial'].includes(tier)
    default:
      return false
  }
}

/**
 * Get the monthly senior developer review allowance for a tenant.
 * Spec reviews are a human cost ($249 NZD), not included in any plan.
 */
export async function getReviewAllowance(
  tenantId: string
): Promise<{ included: number; used: number; remaining: number }> {
  return { included: 0, used: 0, remaining: 0 }
}
