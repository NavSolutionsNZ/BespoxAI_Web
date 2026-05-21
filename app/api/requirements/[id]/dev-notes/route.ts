/**
 * POST /api/requirements/[id]/dev-notes
 *
 * Streaming AI developer assistant for the superadmin quoting workflow.
 * Provider, model, and feature flags are driven by AI_CONFIG (lib/ai-config.ts).
 * Accepts { question, history, docContent } — history is the full prior conversation
 * so the AI can answer follow-up questions with full context.
 * Superadmin only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getAiConfig } from '@/lib/ai-config'
import { logAiUsage } from '@/lib/ai-usage'
import { buildTenantContext } from '@/lib/tenant-context'

export const dynamic    = 'force-dynamic'
export const maxDuration = 60

// ── BC / NAV Extension Knowledge Base ────────────────────────────────────────

const EXTENSION_KB = `
## Known BC / NAV Extension Complexity Guide

**Continia Document Capture**
- OCR-based AP invoice processing with approval workflow
- Standard integration: 25–40 hours. Custom approval routing: add 10–20h
- Key touchpoints: Vendor Ledger, Purchase Headers, approval users, G/L posting
- Risk: Customer must license Continia separately. Field mapping per vendor is manual setup.

**Continia Payment Management**
- Electronic payment file generation (domestic + international)
- Integration: 15–30 hours. Complexity depends on bank formats required (ANZ, BNZ, ASB differ)
- Key touchpoints: Vendor Bank Accounts, Payment Journal, Continia Payment Proposal

**Xero ↔ BC Integration**
- Bi-directional sync: chart of accounts, customers, vendors, invoices, payments
- Typical scope: 30–60 hours. Real-time webhooks add 15–25h.
- Key risks: Currency mapping, tax code alignment (NZ GST vs Xero tax rates), duplicate detection
- Common approach: scheduled job via API; Xero OAuth2 token management needed

**Jet Reports / Jet Analytics**
- Custom financial reporting layer on top of BC/NAV data
- Simple tabular report: 8–15h. Complex P&L with dimensions/budget compare: 20–40h
- Jet requires separate licensing. Reports are Excel-based; no AL code.

**Zetadocs**
- Document delivery, archiving, and e-signing integrated with BC
- Basic email delivery setup: 10–20h. Full archive + SharePoint: 30–50h
- Key touchpoints: Posted Sales Invoices, Purchase Orders, customer/vendor email fields

**Tasklet Factory Mobile WMS**
- Warehouse scanning for item tracking, pick/put-away, physical inventory
- Integration: 30–60h. Custom fields or workflows add 20–40h.
- Requires BC Warehouse Management module to be active

**Sana Commerce**
- B2B e-commerce portal synced to BC items, pricing, stock, orders
- Standard setup: 40–80h. Custom pricing tiers or catalog filtering: +20–40h
- Key risks: Item attribute mapping, BC pricing group alignment, order workflow

**LS Retail / LS Central**
- Retail POS integrated with BC inventory and finance
- Base install on existing BC: 60–120h. New implementation: 200+h
- High complexity; usually requires LS Retail certified partner involvement

**Power BI Embedded**
- Embedding Power BI reports/dashboards inside BC pages
- Report development: 10–30h per report. Embedding + Row-Level Security: +15h
- Requires Power BI Pro licenses; tenant Azure AD setup needed

**General AL Extension Development (no ISV)**
- Simple page extension (add fields, modify layout): 4–12h
- New codeunit / business logic: 8–25h
- Event subscriber integration: 5–15h
- New API endpoint: 8–20h
- Report extension: 6–20h
- Workflow / approval extension: 15–35h
- Per-environment deployment + testing: +4–8h fixed cost

**NAV → BC Migration Work**
- Data migration (master data): 20–40h per entity type
- Custom C/AL code rewrite to AL: 2–4h per function on average
- Jet/SSRS report conversion: 8–20h per report
`

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildSpecText(aiSpec: string | null): string {
  if (!aiSpec) return ''
  try {
    const spec = JSON.parse(aiSpec)
    const lines: string[] = []
    if (spec.userStory)                   lines.push(`User Story: ${spec.userStory}`)
    if (spec.complexity)                  lines.push(`Complexity: ${spec.complexity} (est. ${spec.estimatedDays} days)`)
    if (spec.acceptanceCriteria?.length)  lines.push(`Acceptance criteria:\n${spec.acceptanceCriteria.map((c: string) => `  - ${c}`).join('\n')}`)
    if (spec.bcObjects?.length)           lines.push(`BC objects involved: ${spec.bcObjects.join(', ')}`)
    if (spec.assumptions?.length)         lines.push(`Assumptions: ${spec.assumptions.join('; ')}`)
    return lines.join('\n')
  } catch { return '' }
}

function buildDevPlanText(devPlan: string | null): string {
  if (!devPlan) return ''
  try {
    const dp = JSON.parse(devPlan)
    const lines: string[] = []
    if (dp.summary)             lines.push(`Summary: ${dp.summary}`)
    if (dp.totalEstimatedHours) lines.push(`Estimated hours: ${dp.totalEstimatedHours}h`)
    if (dp.tasks?.length)       lines.push(`Tasks:\n${dp.tasks.map((t: any) => `  - ${t.name}: ${t.hours}h — ${t.notes ?? ''}`).join('\n')}`)
    return lines.join('\n')
  } catch { return '' }
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const cfg = await getAiConfig()

  if (!cfg.features.devAssistant)
    return NextResponse.json({ error: 'AI Dev Assistant is currently disabled' }, { status: 503 })

  const apiKey = cfg.provider === 'anthropic'
    ? process.env.ANTHROPIC_API_KEY
    : process.env.OPENAI_API_KEY

  if (!apiKey)
    return NextResponse.json({ error: `No API key set for provider "${cfg.provider}"` }, { status: 503 })

  const { question, history = [], docContent } = await req.json()
  if (!question?.trim())
    return NextResponse.json({ error: 'Question is required' }, { status: 400 })

  // Names
  const adminName  = (session.user as any).name  ?? 'Admin'
  const adminEmail = (session.user as any).email ?? ''

  const requirement = await (prisma as any).requirement.findUnique({
    where: { id: params.id },
    include: {
      tenant: true,
      user:   { select: { name: true, email: true } },
    },
  })
  if (!requirement)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const customerName  = requirement.user?.name  ?? 'Customer'
  const customerEmail = requirement.user?.email ?? ''
  const tenantName    = requirement.tenant?.name ?? 'Unknown Tenant'
  const bcVersion     = requirement.tenant?.navVersion ?? 'unknown'

  const specText    = buildSpecText(requirement.aiSpec)
  const devPlanText = buildDevPlanText(requirement.devPlan)

  // Per-tenant accumulated knowledge — BC environment, history, known objects
  const tenantCtx = await buildTenantContext(requirement.tenantId)

  const systemPrompt = `You are a senior Microsoft Dynamics 365 Business Central developer and consultant at BespoxAI.
You are currently assisting ${adminName} (${adminEmail}) with quoting and reviewing a customisation request.

CUSTOMER: ${customerName} (${customerEmail}) at ${tenantName}
BC VERSION: ${bcVersion}

${tenantCtx}

REQUIREMENT:
Title: ${requirement.title}
Area: ${requirement.bcArea}
Priority: ${requirement.priority}
Description: ${requirement.description}
${specText    ? `\nAI SPECIFICATION:\n${specText}`    : ''}
${devPlanText ? `\nDEVELOPER PLAN:\n${devPlanText}`   : ''}
${requirement.feasibility ? `\nFEASIBILITY: ${requirement.feasibility} — ${requirement.feasibilityNotes ?? ''}` : ''}
${requirement.feasibilityCostRange ? `COST RANGE: ${requirement.feasibilityCostRange}` : ''}
${requirement.quote ? `QUOTE AMOUNT: $${requirement.quote} NZD` : ''}
${docContent ? `\nUPLOADED DOCUMENTATION:\n${docContent}` : ''}

${EXTENSION_KB}

GUIDELINES:
- Be specific. Reference hours, risks, assumptions, and dependencies from the context above.
- For internal developer notes: be technical and precise.
- When drafting customer-facing consultant notes:
  • Address the customer as ${customerName}
  • Sign off as ${adminName} from BespoxAI
  • Keep language professional and value-focused — avoid implementation jargon
- When estimating effort, use the extension knowledge base and dev plan if available.
- Do not fabricate specific integration details you are uncertain about — say so explicitly.`

  // Build message array including full conversation history
  const messages = [
    ...history.map((h: { role: string; content: string }) => ({
      role:    h.role === 'assistant' ? 'assistant' : 'user',
      content: h.content,
    })),
    { role: 'user', content: question },
  ]

  // ── Anthropic streaming ───────────────────────────────────────────────────
  if (cfg.provider === 'anthropic') {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:       cfg.model,
        max_tokens:  cfg.maxTokens,
        temperature: cfg.temperature,
        stream:      true,
        system:      systemPrompt,
        messages,
      }),
    })

    if (!upstream.ok) {
      const err = await upstream.text()
      console.error(`[dev-notes] Anthropic API error ${upstream.status} — model: ${cfg.model} — ${err}`)
      return NextResponse.json({ error: `Anthropic error: ${upstream.status} — ${err}` }, { status: 502 })
    }

    // Intercept SSE to capture token counts, pass everything through unchanged
    let inputTokens  = 0
    let outputTokens = 0
    let sseBuffer    = ''
    const tenantId   = requirement.tenantId
    const reqId      = params.id
    const model      = cfg.model

    const transform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk) // pass through untouched
        sseBuffer += new TextDecoder().decode(chunk)
        const lines = sseBuffer.split('\n')
        sseBuffer   = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'message_start')
              inputTokens  = data.message?.usage?.input_tokens  ?? inputTokens
            if (data.type === 'message_delta')
              outputTokens = data.usage?.output_tokens ?? outputTokens
          } catch { /* skip malformed */ }
        }
      },
      async flush() {
        await logAiUsage({ tenantId, requirementId: reqId, feature: 'dev_assistant', model, inputTokens, outputTokens })
      },
    })

    return new Response(upstream.body!.pipeThrough(transform), {
      headers: {
        'Content-Type':  'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-AI-Provider': 'anthropic',
      },
    })
  }

  // ── OpenAI streaming (normalised to same SSE format) ─────────────────────
  const OpenAI = (await import('openai')).default
  const openai  = new OpenAI({ apiKey })

  const stream = await openai.chat.completions.create({
    model:       cfg.model,
    max_tokens:  cfg.maxTokens,
    temperature: cfg.temperature,
    stream:      true,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages as any,
    ],
  })

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      let inputTokens = 0, outputTokens = 0
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content ?? ''
        if (text) {
          const event = { type: 'content_block_delta', delta: { type: 'text_delta', text } }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        }
        // OpenAI includes usage on the final chunk when stream_options.include_usage is set
        if (chunk.usage) {
          inputTokens  = chunk.usage.prompt_tokens     ?? 0
          outputTokens = chunk.usage.completion_tokens ?? 0
        }
      }
      controller.enqueue(encoder.encode('data: {"type":"message_stop"}\n\n'))
      controller.close()
      await logAiUsage({ tenantId: requirement.tenantId, requirementId: params.id, feature: 'dev_assistant', model: cfg.model, inputTokens, outputTokens })
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-AI-Provider': 'openai',
    },
  })
}
