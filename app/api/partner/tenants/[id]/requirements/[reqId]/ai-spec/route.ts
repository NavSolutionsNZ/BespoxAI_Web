import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerSession, assertTenantBelongsToPartner } from '@/lib/partner-auth'
import { prisma } from '@/lib/db'
import { getAiConfig } from '@/lib/ai-config'
import { buildTenantContext, resolveBcVersion } from '@/lib/tenant-context'
import { buildObjectContextSection } from '@/lib/bc-object-parser'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_GENS = 4

function buildSystemPrompt(bcVersion: string) {
  return `You are a senior Microsoft Dynamics 365 Business Central / Navision (NAV) expert with 20+ years of experience as both a functional consultant and a developer. You have deep hands-on knowledge of:
- BC/NAV object model: Tables, Pages, Codeunits, Reports, XMLports, Queries, Enums, Interfaces
- AL language development, extensions, AppSource publishing
- Business Central versions from NAV 2009 through BC SaaS (v15–25) and BC 14 on-premise
- Standard BC functional areas: Finance, Sales, Purchase, Inventory, Manufacturing, Projects, Service, Warehousing, HR, Fixed Assets
- Customisation patterns: approval workflows, custom fields, posting routines, integrations, report layouts, dimensions, posting groups, number series
- NZ/AU localisation: GST, PEPPOL e-invoicing, bank reconciliation, IRD requirements

The customer is running: **${bcVersion}**

Tailor every part of your output to this specific version:
- Reference the correct development model (C/AL for NAV and BC14 hybrid; AL extensions for BC15+)
- Use exact standard object IDs relevant to this version (e.g. Table 36 Sales Header, Page 42, Codeunit 80)
- Note any version-specific gotchas, deprecated patterns, or recommended approaches
- For NAV versions: reference C/AL objects and modification approach
- For BC SaaS: reference AL extension patterns, app dependencies, event subscribers

SPEC GENERATION RULES:
You are producing a COMPLETE, AUTHORITATIVE functional specification for ONE specific customisation requirement. This is always a FULL REWRITE — synthesise all context provided into a single, coherent, definitive spec.

Do NOT reference previous versions or say "as before". The output must stand alone.

For the _changeSummary field: briefly describe what is new or different versus the original description (e.g. "Added prerelease customer flag after Q&A. Extended validation to quotes and invoices."). For the initial generation, set this to "Initial specification".

Respond ONLY with valid JSON — no markdown, no preamble:
{
  "userStory": "As a [specific role], I want [specific capability] so that [measurable business value].",
  "acceptanceCriteria": [
    "Given [context], when [action], then [specific measurable outcome].",
    "..."
  ],
  "bcObjects": [
    "Table 36 Sales Header — add field 50100 Approval_Status (Option: Open,Pending,Approved,Rejected)",
    "..."
  ],
  "complexity": "Simple",
  "estimatedDays": 3,
  "assumptions": [
    "Explicit assumption about scope or behaviour",
    "..."
  ],
  "questions": [
    "Only questions genuinely still unanswered after ALL context provided",
    "..."
  ],
  "notes": "Technical implementation notes specific to ${bcVersion}. Version-specific gotchas, recommended patterns, standard objects to leverage.",
  "_changeSummary": "What is new or different in this version"
}

Rules:
- Generate 3–6 acceptance criteria (Given/When/Then format)
- Reduce questions with each generation — only include what is genuinely still unclear after all Q&A
- Complexity: Simple (1–3d), Medium (4–10d), Complex (10+d)
- Be specific to ${bcVersion} — reference exact standard objects for this version
- The spec must be self-contained and fully understandable by a BC developer with no other context`
}

function repairJSON(raw: string): string {
  let s = raw.trim().replace(/,\s*$/, '')
  const stack: string[] = []
  let inString = false
  let escape   = false
  for (const ch of s) {
    if (escape)        { escape = false; continue }
    if (ch === '\\')   { escape = true; continue }
    if (ch === '"')    { inString = !inString; continue }
    if (inString)      continue
    if (ch === '{')    stack.push('}')
    else if (ch === '[') stack.push(']')
    else if (ch === '}' || ch === ']') stack.pop()
  }
  if (inString) s += '"'
  return s + stack.reverse().join('')
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; reqId: string } }
) {
  const session = await requirePartnerSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await assertTenantBelongsToPartner(params.id, session.partnerAccountId)
  } catch {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const req_data = await (prisma as any).requirement.findFirst({
    where: { id: params.reqId, tenantId: params.id },
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
  if (!req_data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let signupBcVersion: string | null = null
  try {
    const signup = await (prisma as any).signupRequest.findFirst({
      where:   { companyName: { contains: req_data.tenant.name.split(' ')[0] } },
      orderBy: { createdAt: 'desc' },
      select:  { bcVersion: true },
    })
    signupBcVersion = signup?.bcVersion ?? null
  } catch { /* use null */ }

  const bcVersion = resolveBcVersion(req_data.tenant, signupBcVersion)
  const tenantCtx = await buildTenantContext(req_data.tenantId)

  let tenantObjectsSection = ''
  try {
    const tenantObjects = await (prisma as any).tenantObjectFile.findMany({
      where:   { tenantId: req_data.tenantId, parseError: false },
      select:  { objectType: true, objectId: true, objectName: true, language: true, summary: true },
      orderBy: { uploadedAt: 'asc' },
    })
    tenantObjectsSection = buildObjectContextSection(tenantObjects)
  } catch { /* non-fatal */ }

  let bodyQA: Array<{q: string; a: string}> | null = null
  try {
    const body = await req.json()
    bodyQA = body.qaStructured ?? null
  } catch { /* no body */ }

  let prevGenCount = 0
  let prevSpec: any = null
  let prevHistory: Array<{ at: string; trigger: string; summary: string; snapshot: any }> = []

  try {
    if (req_data.aiSpec) {
      prevSpec = JSON.parse(req_data.aiSpec)
      prevGenCount = prevSpec._genCount ?? 0
      prevHistory = prevSpec._history ?? []
    }
  } catch { /* malformed spec — continue as initial generation */ }

  if (prevGenCount >= MAX_GENS) {
    return NextResponse.json({
      error: 'Maximum regenerations reached. Contact your partner for further changes.',
    }, { status: 400 })
  }

  const isRefinement = prevGenCount > 0

  let aiQASection = ''
  const qaToUse = bodyQA ?? (() => {
    try {
      const saved = req_data.customerAnswers ? JSON.parse(req_data.customerAnswers) : null
      return Array.isArray(saved) && saved[0]?.q ? saved : null
    } catch { return null }
  })()
  if (qaToUse && qaToUse.length > 0) {
    aiQASection = '\n--- Customer answers to AI clarifying questions ---\n' +
      qaToUse.map((p: any, i: number) => `Q${i+1}: ${p.q}\nA${i+1}: ${p.a}`).join('\n\n')
  }

  let adminQASection = ''
  try {
    const qaLog = req_data.adminQALog ? JSON.parse(req_data.adminQALog) : []
    if (qaLog.length > 0) {
      adminQASection = '\n--- Consultant/admin Q&A rounds ---\n' +
        qaLog.map((r: any) => [
          `Round ${r.round} — ${new Date(r.askedAt).toLocaleDateString()}:`,
          `Consultant questions:\n${r.questions}`,
          r.answers ? `Customer answers:\n${r.answers}` : `(awaiting customer response)`,
        ].join('\n')).join('\n\n')
    }
  } catch { /* ignore */ }

  const prompt = [
    `BC Area: ${req_data.bcArea}`,
    `Priority: ${req_data.priority.replace(/_/g, ' ')}`,
    `Title: ${req_data.title}`,
    '',
    'Original customer description:',
    req_data.description,
    tenantCtx ? `\n${tenantCtx}` : '',
    tenantObjectsSection,
    aiQASection,
    adminQASection,
  ].filter(Boolean).join('\n')

  let spec: any
  try {
    const cfg = await getAiConfig()
    const apiKey = cfg.provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error(`No API key for provider "${cfg.provider}"`)

    let raw = ''
    if (cfg.provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: cfg.model, max_tokens: cfg.maxTokens, temperature: cfg.temperature, system: buildSystemPrompt(bcVersion), messages: [{ role: 'user', content: prompt }] }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error?.message ?? `Anthropic error ${res.status}`)
      raw = d.content?.[0]?.text ?? ''
      const { logAiUsage } = await import('@/lib/ai-usage')
      logAiUsage({ tenantId: req_data.tenantId, requirementId: params.reqId, feature: 'spec_gen', model: cfg.model, inputTokens: d.usage?.input_tokens ?? 0, outputTokens: d.usage?.output_tokens ?? 0 })
    } else {
      const OpenAI = (await import('openai')).default
      const openai = new OpenAI({ apiKey })
      const completion = await openai.chat.completions.create({
        model: cfg.model, temperature: cfg.temperature, max_tokens: cfg.maxTokens,
        messages: [{ role: 'system', content: buildSystemPrompt(bcVersion) }, { role: 'user', content: prompt }],
      })
      raw = completion.choices[0]?.message?.content ?? ''
      const { logAiUsage } = await import('@/lib/ai-usage')
      logAiUsage({ tenantId: req_data.tenantId, requirementId: params.reqId, feature: 'spec_gen', model: cfg.model, inputTokens: completion.usage?.prompt_tokens ?? 0, outputTokens: completion.usage?.completion_tokens ?? 0 })
    }
    if (!raw) throw new Error('Empty response from AI')
    const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim()
    let parsed: any = null
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      try { parsed = JSON.parse(repairJSON(cleaned)) } catch {
        throw new Error('AI returned malformed JSON. Please try again.')
      }
    }
    spec = parsed
  } catch (err: any) {
    console.error('AI spec generation failed:', err)
    return NextResponse.json({ error: err.message ?? 'AI generation failed. Please try again.' }, { status: 500 })
  }

  const triggerDescription = 'Regenerated by developer'

  const newHistory = isRefinement && prevSpec
    ? [
        ...prevHistory,
        {
          at:       new Date().toISOString(),
          trigger:  triggerDescription,
          summary:  prevSpec._changeSummary ?? `Version ${prevGenCount}`,
          snapshot: (({ _genCount, _history, ...rest }) => rest)(prevSpec),
        },
      ].slice(-5)
    : []

  const specWithMeta = {
    ...spec,
    _genCount: prevGenCount + 1,
    _history:  newHistory,
  }

  const answersToSave = bodyQA
    ? JSON.stringify(bodyQA)
    : (req_data.customerAnswers || undefined)

  const updated = await (prisma as any).requirement.update({
    where: { id: params.reqId },
    data:  { aiSpec: JSON.stringify(specWithMeta), customerAnswers: answersToSave },
    include: {
      user:   { select: { name: true, email: true } },
      tenant: { select: { name: true, country: true, paymentTermsKey: true } },
      addenda: { orderBy: { createdAt: 'asc' }, select: { id: true, title: true, status: true, quote: true, createdAt: true, parentId: true } },
    },
  })

  return NextResponse.json({
    requirement: updated,
    spec:        specWithMeta,
    genCount:    prevGenCount + 1,
    maxGens:     MAX_GENS,
    isRefinement,
  })
}
