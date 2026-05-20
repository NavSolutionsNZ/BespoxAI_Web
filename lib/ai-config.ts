/**
 * lib/ai-config.ts
 *
 * Central AI configuration for BespoxAI.
 * All values are driven by Vercel environment variables — no code changes needed
 * to switch provider, model, or toggle features. Configure in:
 * Vercel Dashboard → Project → Settings → Environment Variables
 *
 * The admin Settings tab surfaces these variables and their current resolved values.
 */

export const AI_CONFIG = {
  /** Master on/off. Set AI_ENABLED=false to disable all AI across the app. */
  enabled: process.env.AI_ENABLED !== 'false',

  /** Provider: 'anthropic' (default) | 'openai' */
  provider: (process.env.AI_PROVIDER ?? 'anthropic') as 'anthropic' | 'openai',

  /** Model name. Defaults per provider if not set. */
  get model() {
    if (process.env.AI_MODEL) return process.env.AI_MODEL
    return this.provider === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-4o'
  },

  /** Max tokens per response */
  maxTokens: parseInt(process.env.AI_MAX_TOKENS ?? '1000', 10),

  /** Temperature 0–1. Lower = more consistent. */
  temperature: parseFloat(process.env.AI_TEMPERATURE ?? '0.4'),

  /** Whether API keys are present (does not expose the key value) */
  get anthropicKeySet() { return !!process.env.ANTHROPIC_API_KEY },
  get openaiKeySet()    { return !!process.env.OPENAI_API_KEY },

  /** Per-feature flags */
  features: {
    devAssistant:   process.env.AI_FEATURE_DEV_ASSISTANT   !== 'false',
    specGeneration: process.env.AI_FEATURE_SPEC_GEN        !== 'false',
    devPlan:        process.env.AI_FEATURE_DEV_PLAN        !== 'false',
    feasibility:    process.env.AI_FEATURE_FEASIBILITY     !== 'false',
    cfoChatQuery:   process.env.AI_FEATURE_CFO_QUERY       !== 'false',
  },
} as const

/**
 * Env var reference — used by the admin Settings UI.
 * Only non-sensitive variables and descriptions are listed here.
 */
export const AI_ENV_VARS: {
  key: string
  label: string
  description: string
  sensitive?: boolean
  default?: string
}[] = [
  { key: 'AI_ENABLED',                label: 'Master switch',       description: 'Set to false to disable all AI features',                           default: 'true' },
  { key: 'AI_PROVIDER',               label: 'Provider',            description: 'anthropic (default) or openai',                                     default: 'anthropic' },
  { key: 'AI_MODEL',                  label: 'Model',               description: 'claude-sonnet-4-20250514 (Anthropic) or gpt-4o (OpenAI)',            default: 'claude-sonnet-4-20250514' },
  { key: 'AI_MAX_TOKENS',            label: 'Max tokens',          description: 'Response length cap per request',                                   default: '1000' },
  { key: 'AI_TEMPERATURE',           label: 'Temperature',         description: '0.0–1.0, lower = more consistent, higher = more creative',          default: '0.4' },
  { key: 'ANTHROPIC_API_KEY',        label: 'Anthropic API key',   description: 'Required when AI_PROVIDER=anthropic',   sensitive: true },
  { key: 'OPENAI_API_KEY',           label: 'OpenAI API key',      description: 'Required when AI_PROVIDER=openai',      sensitive: true },
  { key: 'AI_FEATURE_DEV_ASSISTANT', label: 'Dev Assistant',       description: 'AI panel in admin requirements review',                             default: 'true' },
  { key: 'AI_FEATURE_SPEC_GEN',      label: 'Spec Generation',     description: 'AI requirement spec generation for customers',                      default: 'true' },
  { key: 'AI_FEATURE_DEV_PLAN',      label: 'Dev Plan',            description: 'AI internal dev plan generation',                                   default: 'true' },
  { key: 'AI_FEATURE_FEASIBILITY',   label: 'Feasibility Check',   description: 'AI feasibility analysis on requirements',                           default: 'true' },
  { key: 'AI_FEATURE_CFO_QUERY',     label: 'CFO Assistant',       description: 'AI responses to CFO chat queries',                                  default: 'true' },
]
