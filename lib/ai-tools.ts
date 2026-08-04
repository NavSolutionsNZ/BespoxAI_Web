/**
 * lib/ai-tools.ts
 *
 * Anthropic tool-use loop over the tenant environment index.
 *
 * Gives AI routes (feasibility, ai-spec, coding assistant) the ability to
 * QUERY the customer's actual objects at answer time instead of relying on
 * prompt-stuffed context:
 *
 *   find_objects        — search by name/id/type, optionally customised-only
 *   get_object          — full source + summary for one object
 *   list_customisations — objects with mod tags / custom fields, by tag/type
 *   where_used          — reverse-reference lookup for an object
 *
 * Anthropic-only by design. The OpenAI fallback path remains for the simple
 * single-shot calls; agentic routes standardise on Anthropic (see
 * ENVIRONMENT_INDEX_GUIDE.md for rationale).
 *
 * Security: tenantId is bound by the caller (route handler auth) and is never
 * accepted from, or exposed to, the model. All tool results are strictly
 * scoped to that one tenant.
 */

import { findObjects, getObject, listCustomisations, whereUsed } from '@/lib/bc-retrieval'

// ── Tool definitions (Anthropic Messages API format) ─────────────────────────

export const BC_INDEX_TOOLS = [
  {
    name: 'find_objects',
    description:
      'Search this customer\'s BC/NAV object index by name fragment, object number, and/or object type. ' +
      'Returns object metadata and parsed summaries (fields, procedures, mod tags) — not full source. ' +
      'Use customised_only=true to see only objects with existing customisations.',
    input_schema: {
      type: 'object',
      properties: {
        query:           { type: 'string',  description: 'Name fragment or object number, e.g. "Sales Line" or "36"' },
        object_type:     { type: 'string',  description: 'Table, Page, Codeunit, Report, XMLport, Query, Tableextension, Pageextension' },
        customised_only: { type: 'boolean', description: 'Only return objects with modification tags or custom fields' },
        limit:           { type: 'integer', description: 'Max results (default 20, max 50)' },
      },
    },
  },
  {
    name: 'get_object',
    description:
      'Fetch one object from this customer\'s index with its FULL source code and parsed summary. ' +
      'Identify it by object_type plus object_id (preferred) or object_name. ' +
      'Use this to read actual customisation code before asserting conflicts or touchpoints.',
    input_schema: {
      type: 'object',
      properties: {
        object_type: { type: 'string',  description: 'Table, Page, Codeunit, Report, etc.' },
        object_id:   { type: 'integer', description: 'Object number, e.g. 36' },
        object_name: { type: 'string',  description: 'Object name, used when object_id is unknown' },
      },
      required: ['object_type'],
    },
  },
  {
    name: 'list_customisations',
    description:
      'List every object in this customer\'s index that carries customisation evidence — ' +
      'AP/CR modification tags or custom fields in the 50000 range. ' +
      'Filter by tag (e.g. "AP2378") to see all objects touched by one change request.',
    input_schema: {
      type: 'object',
      properties: {
        tag:         { type: 'string', description: 'AP/CR tag, e.g. "AP2378"' },
        object_type: { type: 'string', description: 'Filter to one object type' },
        limit:       { type: 'integer', description: 'Max results (default 50, max 100)' },
      },
    },
  },
  {
    name: 'where_used',
    description:
      'Reverse-reference lookup: find every stored object whose source references the target object ' +
      '(variable declarations, RunObject, SourceTable, TableRelation, direct RUN calls, extends). ' +
      'Essential before proposing changes to a shared object — a missed reference is a missed conflict.',
    input_schema: {
      type: 'object',
      properties: {
        object_type: { type: 'string',  description: 'Type of the target object' },
        object_id:   { type: 'integer', description: 'Number of the target object' },
        object_name: { type: 'string',  description: 'Name of the target object (for name-based references)' },
      },
      required: ['object_type'],
    },
  },
] as const

// ── Result shaping ────────────────────────────────────────────────────────────

function shapeRow(r: any) {
  return {
    objectType: r.objectType,
    objectId:   r.objectId,
    objectName: r.objectName,
    language:   r.language,
    summary:    r.summary ?? {},
  }
}

// ── Tool dispatch ─────────────────────────────────────────────────────────────

export async function dispatchIndexTool(
  tenantId: string,
  name: string,
  input: any,
): Promise<string> {
  try {
    switch (name) {
      case 'find_objects': {
        const rows = await findObjects(tenantId, {
          q:              input?.query,
          objectType:     input?.object_type,
          customisedOnly: !!input?.customised_only,
          limit:          input?.limit,
        })
        return JSON.stringify({ count: rows.length, objects: rows.map(shapeRow) })
      }
      case 'get_object': {
        const row = await getObject(tenantId, {
          objectType: input?.object_type,
          objectId:   input?.object_id ?? null,
          objectName: input?.object_name ?? null,
        })
        if (!row) return JSON.stringify({ found: false, note: 'Object not in this customer\'s index. It may be an unmodified base object not uploaded, or the identifier may be wrong.' })
        return JSON.stringify({
          found: true,
          ...shapeRow(row),
          content:   row.content ?? null,
          truncated: row.truncated,
        })
      }
      case 'list_customisations': {
        const rows = await listCustomisations(tenantId, {
          tag:        input?.tag,
          objectType: input?.object_type,
          limit:      input?.limit,
        })
        return JSON.stringify({ count: rows.length, objects: rows.map(shapeRow) })
      }
      case 'where_used': {
        const res = await whereUsed(tenantId, {
          objectType: input?.object_type,
          objectId:   input?.object_id ?? null,
          objectName: input?.object_name ?? null,
        })
        return JSON.stringify({ target: res.target, count: res.usedBy.length, usedBy: res.usedBy.map(shapeRow) })
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` })
    }
  } catch (e: any) {
    return JSON.stringify({ error: e?.message ?? 'Tool execution failed' })
  }
}

// ── Tool loop ─────────────────────────────────────────────────────────────────

export interface ToolLoopParams {
  tenantId:      string
  apiKey:        string
  model:         string
  system:        string
  messages:      Array<{ role: 'user' | 'assistant'; content: any }>
  maxTokens?:    number
  temperature?:  number
  maxIterations?: number
}

export interface ToolLoopResult {
  text:         string
  iterations:   number
  inputTokens:  number
  outputTokens: number
  toolTrace:    Array<{ tool: string; input: any }>
  stopReason:   string | null
}

/**
 * Run an Anthropic Messages call with the index tools, executing tool_use
 * requests against this tenant's index until the model finishes or the
 * iteration cap is hit. Returns concatenated final text + usage totals.
 */
export async function runIndexToolLoop(params: ToolLoopParams): Promise<ToolLoopResult> {
  const {
    tenantId, apiKey, model, system,
    maxTokens = 2500, temperature = 0.2, maxIterations = 8,
  } = params

  const messages: any[] = [...params.messages]
  const toolTrace: Array<{ tool: string; input: any }> = []
  let inputTokens = 0, outputTokens = 0
  let iterations = 0
  let stopReason: string | null = null

  while (iterations < maxIterations) {
    iterations++

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens:  maxTokens,
        temperature,
        system,
        tools: BC_INDEX_TOOLS,
        messages,
      }),
    })

    const d: any = await res.json()
    if (!res.ok) throw new Error(d?.error?.message ?? `Anthropic error ${res.status}`)

    inputTokens  += d.usage?.input_tokens  ?? 0
    outputTokens += d.usage?.output_tokens ?? 0
    stopReason = d.stop_reason ?? null

    if (d.stop_reason !== 'tool_use') {
      const text = (d.content ?? [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n')
      return { text, iterations, inputTokens, outputTokens, toolTrace, stopReason }
    }

    // Execute every tool_use block, echo assistant turn + tool results back
    messages.push({ role: 'assistant', content: d.content })

    const toolResults: any[] = []
    for (const block of d.content ?? []) {
      if (block.type !== 'tool_use') continue
      toolTrace.push({ tool: block.name, input: block.input })
      const result = await dispatchIndexTool(tenantId, block.name, block.input)
      toolResults.push({
        type:        'tool_result',
        tool_use_id: block.id,
        content:     result,
      })
    }
    messages.push({ role: 'user', content: toolResults })
  }

  // Iteration cap hit — ask for a final answer without tools
  messages.push({
    role: 'user',
    content:
      'Tool budget reached. Provide your final answer now using only what you have already retrieved. ' +
      'Note any areas you could not verify.',
  })

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature, system, messages }),
  })
  const d: any = await res.json()
  if (!res.ok) throw new Error(d?.error?.message ?? `Anthropic error ${res.status}`)
  inputTokens  += d.usage?.input_tokens  ?? 0
  outputTokens += d.usage?.output_tokens ?? 0

  const text = (d.content ?? [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n')

  return { text, iterations, inputTokens, outputTokens, toolTrace, stopReason: d.stop_reason ?? null }
}
