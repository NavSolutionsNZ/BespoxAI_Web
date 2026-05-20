import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import OpenAI from 'openai'
import { buildObjectContextSection } from '@/lib/bc-object-parser'
import { checkTokenLimit } from '@/lib/tier'

export const dynamic   = 'force-dynamic'
export const maxDuration = 60

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const MAX_GENS = 4  // 1 initial + 3 customer-driven refinements

// ── BC/NAV version string ──────────────────────────────────────────────────────

function resolveBcVersion(tenant: {
  navProduct: string | null
  navVersion: string | null
  lastCU:     string | null
  bcInstance: string
  name:       string
}, signupBcVersion?: string | null): string {
  // Prefer onboarding-captured fields (most accurate — set by the tenant themselves)
  if (tenant.navProduct && tenant.navVersion) {
    const parts = [tenant.navVersion]
    if (tenant.lastCU) parts.push(`CU: ${tenant.lastCU}`)
    if (tenant.navProduct === 'NAV') parts.push('(C/AL — Navision on-premise)')
    else if (tenant.navProduct === 'BC') {
      // Detect on-prem BC14 which uses C/AL hybrid
      const isOnPremHybrid = tenant.navVersion.toLowerCase().includes('14')
      if (isOnPremHybrid) parts.push('(on-premise, C/AL + AL hybrid)')
      else parts.push('(AL extensions)')
    }
    return parts.join(' — ')
  }

  // Fall back to signup request bcVersion code
  if (signupBcVersion) {
    const vMap: Record<string, string> = {
      BC14:    'BC 14 (on-premise, C/AL + AL hybrid)',
      BC15:    'BC 15 (AL extensions)',
      BC16:    'BC 16 (AL extensions)',
      BC17:    'BC 17 (AL extensions)',
      BC18:    'BC 18 (AL extensions)',
      BC19:    'BC 19 (AL extensions)',
      BC20:    'BC 20 (AL extensions)',
      BC21:    'BC 21 (AL extensions)',
      BC22:    'BC 22 (AL extensions)',
      BC23:    'BC 23 (AL extensions)',
      BC24:    'BC 24 (AL extensions)',
      BC25:    'BC 25 (AL extensions, latest)',
      NAV2009: 'NAV 2009 (C/AL)',
      NAV2013: 'NAV 2013 (C/AL)',
      NAV2015: 'NAV 2015 (C/AL)',
      NAV2016: 'NAV 2016 (C/AL)',
      NAV2017: 'NAV 2017 (C/AL)',
      NAV2018: 'NAV 2018 (C/AL)',
    }
    return vMap[signupBcVersion] ?? signupBcVersion
  }

  // Last resort — bcInstance gives some signal
  if (tenant.bcInstance && tenant.bcInstance !== 'GWM_Dev') {
    return `Business Central (instance: ${tenant.bcInstance} — version not confirmed)`
  }

  return 'Business Central / NAV (version not confirmed — assume latest BC SaaS unless context suggests otherwise)'
}

// ── System prompt ─────────────────────────────────────────────────────────────

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

// ── JSON repair ───────────────────────────────────────────────────────────────

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

// ── POST /api/requirements/[id]/ai-spec ──────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any

  // Include all version fields on the tenant
  const req_data = await (prisma as any).requirement.findUnique({
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
  if (!req_data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (user.role !== 'superadmin' && req_data.tenantId !== user.tenantId)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Token limit check — skip for superadmin
  if (user.role !== 'superadmin') {
    const tokenStatus = await checkTokenLimit(req_data.tenantId)
    if (!tokenStatus.allowed)
      return NextResponse.json(
        { error: 'token_limit_reached', used: tokenStatus.used, limit: tokenStatus.limit, tier: tokenStatus.tier },
        { status: 429 }
      )
  }

  // ── BC version — prefer onboarding fields, fall back to signup request ────
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

  // ── Tenant deployed objects (all requirements, not just this one) ─────────
  let tenantObjectsSection = ''
  try {
    const tenantObjects = await (prisma as any).tenantObjectFile.findMany({
      where:   { tenantId: req_data.tenantId, parseError: false },
      select:  { objectType: true, objectId: true, objectName: true, language: true, summary: true },
      orderBy: { uploadedAt: 'asc' },
    })
    tenantObjectsSection = buildObjectContextSection(tenantObjects)
  } catch { /* non-fatal — spec generation continues without object context */ }

  // ── Parse request body ────────────────────────────────────────────────────
  let bodyQA: Array<{q: string; a: string}> | null = null
  let customerRefinements = ''
  let editedUserStory     = ''
  let editedCriteria: string[] = []

  try {
    const body          = await req.json()
    bodyQA              = body.qaStructured ?? null
    customerRefinements = body.customerRefinements ?? ''
    editedUserStory     = body.editedUserStory ?? ''
    editedCriteria      = body.editedCriteria ?? []
  } catch { /* no body */ }

  // ── Read previous spec ────────────────────────────────────────────────────
  let prevGenCount = 0
  let prevSpec: any = null
  let prevHistory: Array<{ at: string; trigger: string; summary: string; snapshot: any }> = []

  try {
    if (req_data.aiSpec) {
      prevSpec     = JSON.parse(req_data.aiSpec)
      prevGenCount = prevSpec._genCount ?? 0
      prevHistory  = prevSpec._history  ?? []
    }
  } catch { /* ignore */ }

  // ── Generation cap ────────────────────────────────────────────────────────
  if (user.role !== 'superadmin' && prevGenCount >= MAX_GENS) {
    return NextResponse.json({
      error: `You have used all ${MAX_GENS} spec generations for this requirement. Please submit your current spec, or contact BespoxAI if further changes are needed.`,
      limitReached: true,
      genCount: prevGenCount,
    }, { status: 429 })
  }

  // ── Free tier: 1 spec total across all requirements ───────────────────────
  // Only checked on first generation for a requirement (prevGenCount === 0)
  // Refinements on the same requirement are still allowed
  if (user.role !== 'superadmin' && prevGenCount === 0) {
    const tenantTier = await (prisma as any).tenant.findUnique({
      where: { id: req_data.tenantId },
      select: { tier: true },
    })
    if (tenantTier?.tier === 'free') {
      const existingSpecCount = await (prisma as any).requirement.count({
        where: {
          tenantId: req_data.tenantId,
          aiSpec:   { not: null },
          id:       { not: params.id },
        },
      })
      if (existingSpecCount >= 1) {
        return NextResponse.json({
          error: 'The free plan includes 1 AI specification so you can evaluate the output quality. Upgrade to Starter ($59/mo) for unlimited spec generation.',
          upgradeRequired: true,
        }, { status: 402 })
      }
    }
  }

  const isRefinement = prevGenCount > 0

  // ── Build context — only inputs specific to THIS requirement ─────────────
  //
  // Context is built fresh every time from the raw inputs for this requirement.
  // We deliberately do NOT include spec version history summaries in the prompt —
  // history is stored for the UI but the AI should synthesise from source inputs,
  // not from its own previous interpretations.

  // 1. Customer answers to AI clarifying questions
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

  // 2. All consultant/admin Q&A rounds for this requirement
  let adminQASection = ''
  try {
    const qaLog = req_data.adminQALog ? JSON.parse(req_data.adminQALog) : []
    if (qaLog.length > 0) {
      adminQASection = '\n--- Consultant/admin Q&A rounds ---\n' +
        qaLog.map((r: any) => [
          `Round ${r.round} — ${new Date(r.askedAt).toLocaleDateString()}:`,
          `Consultant questions:\n${r.questions}`,
          r.answers
            ? `Customer answers:\n${r.answers}`
            : `(awaiting customer response)`,
        ].join('\n')).join('\n\n')
    }
  } catch { /* ignore */ }

  // 3. Customer-requested changes for this regeneration
  let changesSection = ''
  if (isRefinement) {
    const parts: string[] = []
    if (customerRefinements.trim())
      parts.push(`Customer's requested changes:\n${customerRefinements.trim()}`)
    if (editedUserStory.trim())
      parts.push(`Customer's edited user story (use verbatim):\n"${editedUserStory.trim()}"`)
    if (editedCriteria.length > 0)
      parts.push(`Customer's edited acceptance criteria (use as base):\n${editedCriteria.map((c, i) => `${i+1}. ${c}`).join('\n')}`)
    if (parts.length > 0)
      changesSection = '\n--- Changes requested for this regeneration ---\n' + parts.join('\n\n')
  }

  // Assemble the prompt from this requirement's source inputs only
  const prompt = [
    `BC Area: ${req_data.bcArea}`,
    `Priority: ${req_data.priority.replace(/_/g, ' ')}`,
    `Title: ${req_data.title}`,
    '',
    'Original customer description:',
    req_data.description,
    tenantObjectsSection,
    aiQASection,
    adminQASection,
    changesSection,
  ].filter(Boolean).join('\n')

  // ── Call AI ───────────────────────────────────────────────────────────────
  let spec: any
  try {
    const completion = await openai.chat.completions.create({
      model:       'gpt-4o',
      temperature: 0.2,
      max_tokens:  4096,
      messages: [
        { role: 'system', content: buildSystemPrompt(bcVersion) },
        { role: 'user',   content: prompt },
      ],
    })
    const raw     = completion.choices[0]?.message?.content ?? ''
    if (!raw) throw new Error('Empty response from AI')
    // Log usage (fire and forget)
    const { logAiUsage } = await import('@/lib/ai-usage')
    logAiUsage({ tenantId: req_data.tenantId, requirementId: params.id, feature: 'spec_gen', model: 'gpt-4o', inputTokens: completion.usage?.prompt_tokens ?? 0, outputTokens: completion.usage?.completion_tokens ?? 0 })
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

  // ── Build history entry (snapshot of previous spec — stored for UI only) ──
  const triggerDescription = (() => {
    if (bodyQA && bodyQA.length > 0)      return `Customer answered ${bodyQA.length} clarifying question${bodyQA.length > 1 ? 's' : ''}`
    if (customerRefinements.trim())        return `Customer refinement: ${customerRefinements.trim().slice(0, 80)}`
    if (editedUserStory.trim())            return 'Customer edited user story directly'
    if (editedCriteria.length > 0)        return 'Customer edited acceptance criteria directly'
    if (adminQASection)                    return 'Regenerated after consultant Q&A'
    return 'Regenerated'
  })()

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

  // ── Save ──────────────────────────────────────────────────────────────────
  const specWithMeta = {
    ...spec,
    _genCount: prevGenCount + 1,
    _history:  newHistory,
  }

  const answersToSave = bodyQA
    ? JSON.stringify(bodyQA)
    : (req_data.customerAnswers || undefined)

  const updated = await (prisma as any).requirement.update({
    where: { id: params.id },
    data:  { aiSpec: JSON.stringify(specWithMeta), customerAnswers: answersToSave },
    include: {
      user:   { select: { name: true, email: true } },
      tenant: { select: { name: true } },
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
