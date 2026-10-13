import type { AiConfigValues } from '@/lib/ai-config'

/**
 * Provider-agnostic single-turn AI call via fetch (no SDK imports — see CLAUDE.md).
 * Returns the text plus token usage for logging.
 */
export async function callAiJson(
  cfg: AiConfigValues,
  apiKey: string,
  system: string,
  user: string,
  maxTokens = 1200,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  if (cfg.provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, temperature: 0, system, messages: [{ role: 'user', content: user }] }),
      signal: AbortSignal.timeout(45_000),
    })
    const d = await res.json()
    if (!res.ok) throw new Error(d?.error?.message ?? 'Anthropic ' + res.status)
    return { text: d.content?.[0]?.text ?? '', inputTokens: d.usage?.input_tokens ?? 0, outputTokens: d.usage?.output_tokens ?? 0 }
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({
      model: cfg.model, max_tokens: maxTokens, temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(45_000),
  })
  const d = await res.json()
  if (!res.ok) throw new Error(d?.error?.message ?? 'OpenAI ' + res.status)
  return { text: d.choices?.[0]?.message?.content ?? '', inputTokens: d.usage?.prompt_tokens ?? 0, outputTokens: d.usage?.completion_tokens ?? 0 }
}
