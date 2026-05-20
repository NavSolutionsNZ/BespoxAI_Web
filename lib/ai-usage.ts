/**
 * lib/ai-usage.ts
 *
 * Fire-and-forget helper to log AI token usage per tenant.
 * Called after every AI API response — never throws, never blocks.
 * Data is written to the AiUsageLog table in Vercel Postgres.
 *
 * Approximate costs (as of mid-2025):
 *   claude-sonnet-4: $3/M input tokens, $15/M output tokens
 *   gpt-4o:          $2.50/M input tokens, $10/M output tokens
 */
import { prisma } from '@/lib/db'

export type AiFeature =
  | 'dev_assistant'
  | 'spec_gen'
  | 'dev_plan'
  | 'feasibility'
  | 'cfo_query'

export interface AiUsageParams {
  tenantId:      string
  requirementId?: string
  feature:       AiFeature
  model:         string
  inputTokens:   number
  outputTokens:  number
}

/** Approximate USD cost based on known model pricing */
export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates: Record<string, { in: number; out: number }> = {
    'claude-sonnet-4-20250514': { in: 3.00,  out: 15.00 },
    'claude-opus-4-20250514':   { in: 15.00, out: 75.00 },
    'claude-haiku-4-5-20251001':{ in: 0.80,  out: 4.00  },
    'gpt-4o':                   { in: 2.50,  out: 10.00 },
    'gpt-4o-mini':              { in: 0.15,  out: 0.60  },
  }
  const r = rates[model] ?? { in: 3.00, out: 15.00 }
  return ((inputTokens * r.in) + (outputTokens * r.out)) / 1_000_000
}

export async function logAiUsage(params: AiUsageParams): Promise<void> {
  try {
    await (prisma as any).aiUsageLog.create({
      data: {
        tenantId:      params.tenantId,
        requirementId: params.requirementId ?? null,
        feature:       params.feature,
        model:         params.model,
        inputTokens:   params.inputTokens,
        outputTokens:  params.outputTokens,
      },
    })
  } catch (e) {
    // Non-fatal — log to console but never surface to client
    console.error('[ai-usage] Failed to log usage:', e)
  }
}
