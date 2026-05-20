/**
 * lib/ai-config.ts
 *
 * AI configuration — read from the AiConfig DB table (managed by superadmin
 * via the admin AI Setup tab). Falls back to safe defaults if the table row
 * doesn't exist yet. API keys remain in Vercel env vars (secrets).
 *
 * Results are cached for 60 seconds so every AI call isn't a DB round-trip.
 */
import { prisma } from '@/lib/db'

export interface AiConfigValues {
  provider:       'anthropic' | 'openai'
  model:          string
  maxTokens:      number
  temperature:    number
  features: {
    devAssistant:   boolean
    specGeneration: boolean
    devPlan:        boolean
    feasibility:    boolean
    cfoChatQuery:   boolean
  }
  anthropicKeySet: boolean
  openaiKeySet:    boolean
  updatedAt?:      Date | null
  updatedBy?:      string | null
}

const DEFAULTS: AiConfigValues = {
  provider:    'anthropic',
  model:       'claude-sonnet-4-5',
  maxTokens:   1000,
  temperature: 0.4,
  features: {
    devAssistant:   true,
    specGeneration: true,
    devPlan:        true,
    feasibility:    true,
    cfoChatQuery:   true,
  },
  anthropicKeySet: false,
  openaiKeySet:    false,
}

// ── 60-second in-process cache ────────────────────────────────────────────────
let _cache: AiConfigValues | null = null
let _cacheAt = 0
const CACHE_TTL_MS = 60_000

export async function getAiConfig(): Promise<AiConfigValues> {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL_MS) return _cache

  try {
    const row = await (prisma as any).aiConfig.findUnique({ where: { id: 'default' } })
    const cfg: AiConfigValues = row ? {
      provider:    row.provider as 'anthropic' | 'openai',
      model:       row.model,
      maxTokens:   row.maxTokens,
      temperature: row.temperature,
      features: {
        devAssistant:   row.devAssistant,
        specGeneration: row.specGeneration,
        devPlan:        row.devPlan,
        feasibility:    row.feasibility,
        cfoChatQuery:   row.cfoChatQuery,
      },
      anthropicKeySet: !!process.env.ANTHROPIC_API_KEY,
      openaiKeySet:    !!process.env.OPENAI_API_KEY,
      updatedAt:       row.updatedAt,
      updatedBy:       row.updatedBy,
    } : { ...DEFAULTS, anthropicKeySet: !!process.env.ANTHROPIC_API_KEY, openaiKeySet: !!process.env.OPENAI_API_KEY }

    _cache   = cfg
    _cacheAt = Date.now()
    return cfg
  } catch {
    return { ...DEFAULTS, anthropicKeySet: !!process.env.ANTHROPIC_API_KEY, openaiKeySet: !!process.env.OPENAI_API_KEY }
  }
}

/** Invalidate cache immediately after a save */
export function invalidateAiConfigCache() {
  _cache   = null
  _cacheAt = 0
}

/** Available models per provider shown in the UI */
export const AVAILABLE_MODELS: Record<string, { id: string; label: string; costHint: string }[]> = {
  anthropic: [
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5',   costHint: 'Fastest · $0.80/M in · $4/M out' },
    { id: 'claude-sonnet-4-5',         label: 'Claude Sonnet 4.5',  costHint: 'Balanced · $3/M in · $15/M out' },
    { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6',  costHint: 'Latest · $3/M in · $15/M out' },
    { id: 'claude-opus-4-5',           label: 'Claude Opus 4.5',    costHint: 'Most capable · $15/M in · $75/M out' },
  ],
  openai: [
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini', costHint: 'Fastest · $0.15/M in · $0.60/M out' },
    { id: 'gpt-4o',      label: 'GPT-4o',      costHint: 'Balanced · $2.50/M in · $10/M out' },
    { id: 'o3-mini',     label: 'o3 Mini',     costHint: 'Reasoning · $1.10/M in · $4.40/M out' },
  ],
}

// Legacy export — keep existing callers working during transition
// Routes that haven't been updated yet can still import AI_CONFIG but get a warning
export const AI_CONFIG = {
  get enabled()     { return true },
  get provider()    { return (process.env.AI_PROVIDER ?? 'anthropic') as 'anthropic' | 'openai' },
  get model()       { return process.env.AI_MODEL ?? 'claude-sonnet-4-5' },
  get maxTokens()   { return parseInt(process.env.AI_MAX_TOKENS ?? '1000', 10) },
  get temperature() { return parseFloat(process.env.AI_TEMPERATURE ?? '0.4') },
  get anthropicKeySet() { return !!process.env.ANTHROPIC_API_KEY },
  get openaiKeySet()    { return !!process.env.OPENAI_API_KEY },
  features: {
    devAssistant:   true,
    specGeneration: true,
    devPlan:        true,
    feasibility:    true,
    cfoChatQuery:   true,
  },
}
