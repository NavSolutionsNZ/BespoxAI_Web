/**
 * POST /api/requirements/[id]/dev-notes
 *
 * AI assistant for the superadmin quoting workflow.
 * Accepts a question + optional pasted doc content and returns a developer-
 * focused answer grounded in the requirement, dev plan, and BC extension
 * knowledge base. Used to justify effort estimates and draft consultant notes.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import OpenAI from 'openai'

export const dynamic    = 'force-dynamic'
export const maxDuration = 60

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// ── Known BC extension knowledge base ────────────────────────────────────────

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

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { question, docContent } = await req.json()
  if (!question?.trim())
    return NextResponse.json({ error: 'Question is required' }, { status: 400 })

  const requirement = await (prisma as any).requirement.findUnique({
    where: { id: params.id },
    include: {
      tenant: true,
      user:   { select: { name: true, email: true } },
    },
  })

  if (!requirement)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Parse dev plan if available
  let devPlanText = ''
  if (requirement.devPlan) {
    try {
      const dp = JSON.parse(requirement.devPlan)
      if (dp.summary)             devPlanText += `Summary: ${dp.summary}\n`
      if (dp.totalEstimatedHours) devPlanText += `Estimated hours: ${dp.totalEstimatedHours}h\n`
      if (dp.tasks?.length)       devPlanText += `Tasks:\n${dp.tasks.map((t: any) => `  - ${t.name}: ${t.hours}h — ${t.notes ?? ''}`).join('\n')}\n`
    } catch { /* ignore */ }
  }

  // Parse AI spec if available
  let specText = ''
  if (requirement.aiSpec) {
    try {
      const spec = JSON.parse(requirement.aiSpec)
      if (spec.userStory)             specText += `User Story: ${spec.userStory}\n`
      if (spec.complexity)            specText += `Complexity: ${spec.complexity} (est. ${spec.estimatedDays} days)\n`
      if (spec.acceptanceCriteria?.length) specText += `Acceptance criteria:\n${spec.acceptanceCriteria.map((c: string) => `  - ${c}`).join('\n')}\n`
      if (spec.bcObjects?.length)     specText += `BC objects involved: ${spec.bcObjects.join(', ')}\n`
      if (spec.assumptions?.length)   specText += `Assumptions: ${spec.assumptions.join('; ')}\n`
    } catch { /* ignore */ }
  }

  const systemPrompt = `You are a senior Microsoft Dynamics 365 Business Central developer and consultant at BespoxAI.
Your role is to help draft pricing justifications and effort estimates for BC/NAV customisation projects.
You give precise, professional answers that can be used directly in customer-facing quote notes.

REQUIREMENT:
Title: ${requirement.title}
Area: ${requirement.bcArea}
Priority: ${requirement.priority}
Description: ${requirement.description}

${specText ? `AI SPECIFICATION:\n${specText}` : ''}
${devPlanText ? `DEVELOPER PLAN:\n${devPlanText}` : ''}
${requirement.feasibility ? `FEASIBILITY: ${requirement.feasibility} — ${requirement.feasibilityNotes ?? ''}` : ''}
${requirement.quote ? `QUOTE AMOUNT: $${requirement.quote} NZD` : ''}

TENANT: ${requirement.tenant.name} (BC version: ${requirement.tenant.navVersion ?? 'unknown'})

${EXTENSION_KB}

${docContent ? `UPLOADED DOCUMENTATION:\n${docContent}\n` : ''}

Guidelines:
- Be specific. Mention hours, risks, assumptions, and dependencies.
- When drafting a consultant note for the customer, keep it professional and non-technical — explain value, not code.
- When estimating effort, use the extension knowledge base above and the dev plan if available.
- Do not fabricate specific integration details you are uncertain about — say so.`

  const completion = await openai.chat.completions.create({
    model:       'gpt-4o',
    max_tokens:  800,
    temperature: 0.4,
    messages: [
      { role: 'system',  content: systemPrompt },
      { role: 'user',    content: question },
    ],
  })

  const answer = completion.choices[0]?.message?.content ?? 'No response generated.'
  return NextResponse.json({ answer })
}
