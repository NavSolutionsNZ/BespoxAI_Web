import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getAiConfig } from '@/lib/ai-config'
import { buildTenantContext, resolveBcVersion } from '@/lib/tenant-context'

export const dynamic = 'force-dynamic'

// ── JSON repair ────────────────────────────────────────────────────────────
function repairJSON(raw: string): string {
  let s = raw.trim().replace(/,\s*$/, '')
  const stack: string[] = []
  let inString = false
  let escape   = false
  for (const ch of s) {
    if (escape)       { escape = false; continue }
    if (ch === '\\')  { escape = true; continue }
    if (ch === '"')   { inString = !inString; continue }
    if (inString)     continue
    if (ch === '{')   stack.push('}')
    else if (ch === '[') stack.push(']')
    else if (ch === '}' || ch === ']') stack.pop()
  }
  if (inString) s += '"'
  return s + stack.reverse().join('')
}

// ── POST /api/requirements/[id]/feasibility ────────────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any

  const requirement = await (prisma as any).requirement.findUnique({
    where: { id: params.id },
    include: {
      tenant: {
        select: {
          name:       true,
          bcInstance: true,
          navProduct: true,
          navVersion: true,
          lastCU:     true,
        },
      },
    },
  })

  if (!requirement)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (user.role !== 'superadmin' && requirement.tenantId !== user.tenantId)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const bcVersion  = resolveBcVersion(requirement.tenant)
  const tenantCtx  = await buildTenantContext(requirement.tenantId)

  const systemPrompt = `You are a senior Microsoft Dynamics 365 Business Central / Navision (NAV) consultant with 20+ years of experience. Classify the customer requirement below into exactly one category and respond ONLY with valid JSON — no markdown, no preamble.

${tenantCtx}

Categories:
- "cfo_assistant": The requirement is a data query, financial report, KPI dashboard, or question answerable directly from live BC/NAV data without any code changes. Examples: show aged debtors, which products have the lowest margin, what are overdue purchase orders, monthly revenue by department, top 10 customers by balance.
- "development": Requires AL or C/AL code changes, new BC objects, workflow automation, custom posting logic, UI changes, integrations, or anything that cannot be answered by querying existing BC data. If genuinely uncertain, choose development.
- "infeasible": Technically not achievable in this BC/NAV version, fundamentally conflicts with BC architecture, or is outside BC customisation scope entirely.

Customer is running: ${bcVersion}

Respond ONLY with valid JSON:
{
  "feasibility": "cfo_assistant" | "development" | "infeasible",
  "feasibilityCostRange": "2-5k" | "5-15k" | "15k+" | null,
  "feasibilityNotes": "2-3 plain English sentences. For cfo_assistant: explain specifically what the CFO Assistant can answer and why no development is needed. For development: confirm it needs building and briefly explain why. For infeasible: explain the specific technical constraint clearly."
}

Rules:
- feasibilityCostRange applies ONLY to development. Set null for cfo_assistant and infeasible.
- Cost ranges (NZD): "2-5k" = simple fields, basic workflows, straightforward report layouts. "5-15k" = multi-object changes, complex workflows, integrations, custom posting routines. "15k+" = major architectural changes, complex integrations, large-scale platform work.
- Be specific — reference BC tables, pages, or codeunits where relevant to this version.`

  const userPrompt = `BC Area: ${requirement.bcArea}
Title: ${requirement.title}

Customer description:
${requirement.description}`

  try {
    const cfg    = await getAiConfig()
    const apiKey = cfg.provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error(`No API key for provider "${cfg.provider}"`)

    let raw = ''
    let inputTokens = 0, outputTokens = 0

    if (cfg.provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: cfg.model, max_tokens: 600, temperature: 0.2, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error?.message ?? `Anthropic error ${res.status}`)
      raw = d.content?.[0]?.text ?? ''
      inputTokens = d.usage?.input_tokens ?? 0; outputTokens = d.usage?.output_tokens ?? 0
    } else {
      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: cfg.model, max_tokens: 600, temperature: 0.2, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }),
      })
      if (!openaiRes.ok) { const err = await openaiRes.json(); throw new Error(err.error?.message ?? 'OpenAI error') }
      const d = await openaiRes.json()
      raw = d.choices?.[0]?.message?.content ?? ''
      inputTokens = d.usage?.prompt_tokens ?? 0; outputTokens = d.usage?.completion_tokens ?? 0
    }

    const clean = raw.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(repairJSON(clean))
    const { logAiUsage } = await import('@/lib/ai-usage')
    logAiUsage({ tenantId: requirement.tenantId, requirementId: params.id, feature: 'feasibility', model: cfg.model, inputTokens, outputTokens })

    const { feasibility, feasibilityCostRange, feasibilityNotes } = parsed

    if (!['cfo_assistant', 'development', 'infeasible'].includes(feasibility)) {
      throw new Error('Unexpected classification value returned')
    }

    const updated = await (prisma as any).requirement.update({
      where: { id: params.id },
      data: {
        feasibility,
        feasibilityCostRange: feasibility === 'development' ? (feasibilityCostRange ?? null) : null,
        feasibilityNotes:     feasibilityNotes ?? null,
        feasibilityCheckedAt: new Date(),
      },
      include: {
        user:   { select: { name: true, email: true } },
        tenant: { select: { name: true, country: true, paymentTermsKey: true } },
        addenda: { orderBy: { createdAt: 'asc' }, select: { id: true, title: true, status: true, quote: true, createdAt: true, parentId: true } },
      },
    })

    const { devPlan, ...sanitised } = updated
    return NextResponse.json({ requirement: user.role === 'superadmin' ? updated : sanitised })

  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? 'Feasibility check failed' },
      { status: 500 }
    )
  }
}
