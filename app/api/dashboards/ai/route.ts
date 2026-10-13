import { NextRequest, NextResponse } from 'next/server'
import { getAiConfig } from '@/lib/ai-config'
import { logAiUsage } from '@/lib/ai-usage'
import { checkTokenLimit } from '@/lib/tier'
import { getDashboardScope } from '@/lib/dashboards/access'
import { validateSpec } from '@/lib/dashboards/validate'
import { applyAiReply, buildSystemPrompt, describeLayout } from '@/lib/dashboards/ai-edit'
import { callAiJson } from '@/lib/dashboards/ai-call'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST { spec, instruction, tenantId? } → { spec, reply, unsupported, applied, rejected }
 * Proposes edits only — nothing is saved. The client shows the result as a
 * draft the user accepts (Save) or discards. No financial figures are sent.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const scope = await getDashboardScope(body?.tenantId)
  if (scope instanceof NextResponse) return scope

  const instruction = typeof body?.instruction === 'string' ? body.instruction.trim() : ''
  if (!instruction) return NextResponse.json({ error: 'instruction is required' }, { status: 400 })
  if (instruction.length > 500) return NextResponse.json({ error: 'Keep the request under 500 characters.' }, { status: 400 })

  const v = validateSpec(body?.spec)
  if (!v.ok) return NextResponse.json({ error: 'invalid_spec', errors: v.errors }, { status: 400 })

  const tokens = await checkTokenLimit(scope.tenantId)
  if (!tokens.allowed) {
    return NextResponse.json({ error: 'token_limit_reached', message: 'This month\'s AI allowance has been used.' }, { status: 429 })
  }

  const cfg = await getAiConfig()
  if (!cfg.features.cfoChatQuery) {
    return NextResponse.json({ error: 'disabled', message: 'The CFO Assistant AI is currently switched off.' }, { status: 503 })
  }
  const apiKey = cfg.provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'No API key configured for provider ' + cfg.provider }, { status: 503 })

  let ai
  try {
    ai = await callAiJson(cfg, apiKey, buildSystemPrompt(), describeLayout(v.spec) + '\n\nRequest: ' + instruction)
  } catch (e: any) {
    return NextResponse.json({ error: 'ai_failed', message: 'The AI service didn\'t respond. Try again.' }, { status: 502 })
  }

  void logAiUsage({ tenantId: scope.tenantId, feature: 'cfo_dashboard', model: cfg.model, inputTokens: ai.inputTokens, outputTokens: ai.outputTokens })

  const result = applyAiReply(v.spec, ai.text)
  return NextResponse.json(result)
}
