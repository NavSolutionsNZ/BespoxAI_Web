import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getTenantById, buildODataUrl } from '@/lib/tenants'
import { getEntitiesSummary } from '@/lib/bc-entities'
import { prisma } from '@/lib/db'
import { checkTierAccess } from '@/lib/tier'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// ─── Types ───────────────────────────────────────────────────────────────────

interface QueryPlan {
  entity: string
  params: string
  reasoning: string
  dateFrom?: string   // ISO date string e.g. "2025-10-01" — set when question is time-period scoped
  dateTo?: string     // ISO date string e.g. "2025-12-31 23:59:59"
  dateField?: string  // field name to filter on e.g. "Posting_Date"
  // Optional second entity to fetch and join with the primary
  secondEntity?: string
  secondParams?: string
  joinKey?: string        // key field on primary entity (e.g. 'No')
  joinForeignKey?: string // matching field on second entity (e.g. 'Document_No')
}

export type DisplayHint = 'narrative' | 'kpi' | 'table' | 'bar_chart' | 'line_chart'
export type QueryMode   = 'data' | 'generic'

export interface StructuredData {
  // Used for table, bar_chart, line_chart
  columns?: string[]
  rows?: (string | number | null)[][]
  // Used for kpi — one or more headline figures
  kpis?: { label: string; value: string; subtext?: string }[]
}

interface AnswerPayload {
  answer: string
  displayHint: DisplayHint
  data: StructuredData | null
}

// ─── Route ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // 1. Auth guard
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Tier gate — block expired trials
  const tierStatus = await checkTierAccess(session.user.tenantId)
  if (!tierStatus.allowed) {
    return NextResponse.json(
      {
        error: 'tier_blocked',
        reason: tierStatus.reason,
        trialEndsAt: 'trialEndsAt' in tierStatus ? tierStatus.trialEndsAt : null,
      },
      { status: 402 }
    )
  }

  // 3. Parse body
  const body = await req.json().catch(() => ({}))
  const question: string = body.question?.trim() ?? ''
  if (!question) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 })
  }

  // Recent conversation turns so follow-ups like "show them" resolve correctly
  const conversationHistory: { role: 'user' | 'assistant'; content: string }[] =
    Array.isArray(body.history) ? body.history.slice(-6) : []

  // ── Step 0a: Rewrite follow-up questions into standalone questions ─────────
  // Catches pronouns/references ("show them", "list those", "and last year?") and
  // rewrites using conversation context so the classifier and planner always see
  // a fully self-contained question — preventing misrouting as generic.
  const FOLLOWUP_PATTERN = /\b(them|those|it|that|these|there|breakdown|break.?down|show|list|expand|give me|what about|and (last|this|next)|same|previous|more|details?)\b/i
  let resolvedQuestion = question

  if (conversationHistory.length >= 2 && FOLLOWUP_PATTERN.test(question)) {
    try {
      const rewriteRes = await openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 120,
        messages: [
          {
            role: 'system',
            content: 'You are a query resolver for a Business Central CFO assistant. Given a conversation and a follow-up question containing pronouns or references to previous results, rewrite it as a complete standalone question with all necessary context. Output ONLY the rewritten question — nothing else. If already standalone, output it unchanged.',
          },
          ...conversationHistory,
          { role: 'user', content: 'Follow-up to rewrite: "' + question + '"' },
        ],
      })
      const rewritten = rewriteRes.choices[0].message.content?.trim() ?? question
      if (rewritten && rewritten.length > 3) resolvedQuestion = rewritten
    } catch { /* fall back to original */ }
  }

  // 3. Load tenant config
  const tenant = await getTenantById(session.user.tenantId)
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not configured' }, { status: 404 })
  }

  // ── Load known bad queries for this tenant ───────────────────────────────
  // These previously caused BC OData 400s — we use them to steer the classifier
  // away from repeating the same mistakes, and exclude them from suggestions.
  let badQueryQuestions: string[] = []
  try {
    const badLogs = await prisma.queryLog.findMany({
      where: { tenantId: tenant.tenantId, entity: '__BAD_QUERY__' },
      select: { question: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    badQueryQuestions = badLogs.map(l => l.question)
  } catch { /* non-fatal */ }

  // ── Step 0: Route — does this question need live BC data? ──────────────────
  // Fast GPT call to classify before hitting the full 3-step pipeline.

  const COUNTRY_MAP: Record<string, string> = {
    NZ: 'New Zealand', AU: 'Australia', GB: 'United Kingdom',
    US: 'United States', ID: 'Indonesia', SG: 'Singapore', MY: 'Malaysia',
  }
  const countryName = COUNTRY_MAP[tenant.country] ?? tenant.country

  const PERSONA = `You are an expert Microsoft Business Central v14 functional consultant and a senior CFO advisor specialising in ${countryName} accounting, tax, and financial reporting standards. You have deep knowledge of BC/NAV configuration, chart of accounts, GST/VAT, and local compliance requirements.`

  // ── Pre-calculate date ranges so GPT never guesses "last quarter" etc. ──
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() // 0-indexed

  const qStart = (q: number, yr: number) => new Date(yr, (q - 1) * 3, 1)
  const qEnd   = (q: number, yr: number) => new Date(yr, q * 3, 0, 23, 59, 59)
  const fmt    = (d: Date) => d.toISOString().slice(0, 10)
  const fmtEnd = (d: Date) => d.toISOString().slice(0, 10) + ' 23:59:59'

  const currentQ  = Math.floor(m / 3) + 1
  const lastQ     = currentQ === 1 ? 4 : currentQ - 1
  const lastQYear = currentQ === 1 ? y - 1 : y
  const prevQ     = lastQ === 1 ? 4 : lastQ - 1
  const prevQYear = lastQ === 1 ? lastQYear - 1 : lastQYear

  const DATE_CONTEXT = `
TODAY: ${fmt(now)} (${now.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })})

Use ONLY these pre-calculated date ranges — never calculate your own:
- This quarter (Q${currentQ} ${y}):        ${fmt(qStart(currentQ, y))} to ${fmtEnd(qEnd(currentQ, y))}
- Last quarter (Q${lastQ} ${lastQYear}):   ${fmt(qStart(lastQ, lastQYear))} to ${fmtEnd(qEnd(lastQ, lastQYear))}
- Previous quarter (Q${prevQ} ${prevQYear}): ${fmt(qStart(prevQ, prevQYear))} to ${fmtEnd(qEnd(prevQ, prevQYear))}
- This year (${y}):                        ${fmt(new Date(y, 0, 1))} to ${fmtEnd(new Date(y, 11, 31))}
- Last year (${y - 1}):                    ${fmt(new Date(y - 1, 0, 1))} to ${fmtEnd(new Date(y - 1, 11, 31))}
- Last 30 days:                            ${fmt(new Date(now.getTime() - 30 * 86400000))} to ${fmt(now)}
- Last 90 days:                            ${fmt(new Date(now.getTime() - 90 * 86400000))} to ${fmt(now)}
- Last 6 months:                           ${fmt(new Date(y, m - 6, 1))} to ${fmt(now)}
- Last 12 months:                          ${fmt(new Date(y - 1, m, 1))} to ${fmt(now)}
- This month (${now.toLocaleString('en-NZ', { month: 'long' })} ${y}): ${fmt(new Date(y, m, 1))} to ${fmtEnd(new Date(y, m + 1, 0))}
- Last month:                              ${fmt(new Date(y, m - 1, 1))} to ${fmtEnd(new Date(y, m, 0))}

CRITICAL: when filtering records by date, always use the EXACT date range above. Apply inclusive boundary comparisons: date >= start AND date <= end.`

  let queryMode: QueryMode = 'data'
  let genericAnswer: { answer: string; suggestedQueries: string[] } | null = null
  let _routeResUsage: { prompt_tokens?: number; completion_tokens?: number } | undefined
  let _answerResUsage: { prompt_tokens?: number; completion_tokens?: number } | undefined

  try {
    const routeRes = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 600,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `${PERSONA}

Classify whether the user's question requires live Business Central data to answer, or can be answered from general BC/accounting/CFO knowledge.

${badQueryQuestions.length > 0 ? `IMPORTANT — the following questions have previously caused OData errors and must NOT be routed as data queries. If the user's question is similar, treat it as needsData=false and explain the limitation:\n${badQueryQuestions.slice(0, 20).map(q => `- ${q}`).join('\n')}\n` : ''}
Return JSON:
{
  "needsData": true | false,
  "reason": "one sentence",
  "answer": "if needsData=false: full expert answer (2-6 sentences, professional CFO tone)",
  "suggestedQueries": ["if needsData=false: 2-3 specific BC data questions the user could ask to get relevant numbers from their live data"]
}

needsData=true for: questions about their specific numbers, customers, invoices, balances, transactions, reports on their data.
needsData=false for: accounting concepts, BC how-to questions, ratio definitions, best practices, what-is questions, strategic CFO advice.`,
        },
        ...conversationHistory,
        { role: 'user', content: resolvedQuestion },
      ],
    })

    const routeRaw  = routeRes.choices[0].message.content ?? '{}'
    _routeResUsage  = routeRes.usage as any
    const routeClean = routeRaw.replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim()
    const routeData  = JSON.parse(routeClean)

    if (!routeData.needsData) {
      queryMode     = 'generic'
      genericAnswer = {
        answer:           routeData.answer ?? 'I can help with that.',
        suggestedQueries: routeData.suggestedQueries ?? [],
      }
    }
  } catch {
    // Classification failed — default to data query
    queryMode = 'data'
  }

  // Return generic answer immediately — no BC data fetch needed
  if (queryMode === 'generic' && genericAnswer) {
    // Still log to history
    prisma.queryLog.create({
      data: {
        tenantId: tenant.tenantId, userId: (session.user as any).id,
        question, answer: genericAnswer.answer,
        displayHint: 'narrative', entity: null, recordCount: 0,
      },
    }).catch(() => {})

    return NextResponse.json({
      answer:          genericAnswer.answer,
      displayHint:     'narrative' as DisplayHint,
      data:            null,
      suggestedQueries: genericAnswer.suggestedQueries,
      meta: { entity: null, reasoning: 'Generic knowledge question — no BC data required', recordCount: 0, odataUrl: null },
    })
  }

  // ── Step 1: Plan — which BC entity & OData params? ──────────────────────

  let plan: QueryPlan
  try {
    const planRes = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 600,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a Microsoft Business Central OData query planner.
${DATE_CONTEXT}
Given a user's natural language question, output ONLY a JSON object with:
  - entity: exact BC OData entity name from the list below
  - params: OData query string (everything after the '?'), e.g. "$top=20&$filter=Balance_LCY gt 0&$orderby=Balance_LCY desc&$select=No,Name,Balance_LCY"
  - reasoning: one-sentence explanation of your choice
  - dateFrom: (string | null) if the question is scoped to a time period, the START date from DATE_CONTEXT in "YYYY-MM-DD" format, else null
  - dateTo: (string | null) if the question is scoped to a time period, the END date from DATE_CONTEXT in "YYYY-MM-DD 23:59:59" format, else null
  - dateField: (string | null) the record field to compare dates against (e.g. "Posting_Date"), else null
  - secondEntity (optional): a second entity to fetch when data must be joined
  - secondParams (optional): OData params for the second entity
  - joinKey (optional): key field on the primary entity (e.g. "No")
  - joinForeignKey (optional): matching field on secondEntity (e.g. "Document_No")

Use secondEntity when you need fields from two entities that must be joined.
Example — invoice totals by month needs dates from SalesInvoice AND amounts from SalesInvoiceSalesLines:
{
  "entity": "SalesInvoice",
  "params": "$top=500&$select=No,Posting_Date,Sell_to_Customer_Name&$orderby=Posting_Date desc",
  "secondEntity": "SalesInvoiceSalesLines",
  "secondParams": "$top=2000&$select=Document_No,Amount_Including_VAT",
  "joinKey": "No",
  "joinForeignKey": "Document_No",
  "reasoning": "Invoice dates from header, amounts from lines, joined on No=Document_No"
}

Available entities:
${getEntitiesSummary(tenant.entityConfig ?? undefined)}

OData rules:
- Always include $top. Rules:
  - Default for simple lookups (no time period): $top=50
  - ANY question involving a time period (last quarter, last month, last year, last N days/months, this quarter, YTD, etc.): $top=1000 — you MUST fetch enough records to cover the full period since you cannot filter by date server-side on posted documents
  - Posted document entities (SalesInvoice, PurchaseInvoice, SalesCrMemo, GeneralLedgerEntry): ALWAYS use $top=1000, never less, because date filtering happens in the answerer step not OData
  - "Show me all" / "list all": $top=500
- Use $select to limit to relevant fields only — always include the key field
- String filter: contains(Name,'text'), startswith(No,'C')
- Date filter on Customer/Vendor/Item (non-posted): Posting_Date ge 2024-01-01T00:00:00Z and Posting_Date le 2024-12-31T23:59:59Z
- NEVER filter by date on posted document entities (SalesInvoice, PurchaseInvoice, SalesCrMemo, GeneralLedgerEntry) — these return 400. Fetch all and let the answerer filter.
- Number filter: Balance_LCY gt 0, Amount ge 10000
- Boolean: Open eq true
- $orderby for sorting: fieldName desc
- Combine with 'and' / 'or'
- OData field names use underscores (e.g. Sell_to_Customer_No, not SellToCustomerNo)
- CRITICAL: only use field names that appear in the entity's Fields list above — never guess or invent field names (e.g. use E_Mail not Email, Balance_LCY not Balance)

CRITICAL — BC 14 does NOT support these — never use them:
- $apply (no aggregation, no groupby, no aggregate())
- $compute, $search
- Lambda operators: any(), all()
- Functions inside $filter: year(), month(), day()

For time-series / "by month" / "over last N months" / trend questions:
- Do NOT attempt OData aggregation — BC 14 will return 400
- Do NOT use $filter on date fields — BC 14 posted-document entities (SalesInvoice, PurchaseInvoice, GeneralLedgerEntry, SalesCrMemo) do not support date filtering and will return 400
- Instead: fetch ALL records with $top=1000, $select only the date + amount fields, $orderby by date desc
- Example for "invoice totals last 6 months": $top=1000&$select=No,Posting_Date,Sell_to_Customer_Name&$orderby=Posting_Date desc
- The answerer step will filter to the EXACT date range from DATE_CONTEXT and group by period
- For invoice/credit memo totals by month: use secondEntity join — SalesInvoice (dates) + SalesInvoiceSalesLines (amounts)
- For purchase totals by month: use secondEntity join — PurchaseInvoice (dates) + PurchaseInvoicePurchLines (amounts)
- SalesInvoice / PurchaseInvoice / SalesCrMemo headers have NO amount fields — never $select Amount or Amount_Including_VAT from them
- SalesInvoiceSalesLines / PurchaseInvoicePurchLines have NO Posting_Date — never $select or $orderby Posting_Date from them`,
        },
        ...conversationHistory,
        { role: 'user', content: resolvedQuestion },
      ],
    })

    const planText = planRes.choices[0].message.content ?? ''
    const clean = planText.replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim()
    plan = JSON.parse(clean)
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Query planner failed', detail: err.message, step: 'planner' },
      { status: 500 },
    )
  }

  // ── Force adequate $top — never trust GPT to pick the right number ────────
  // Posted document entities cannot be date-filtered server-side (BC 14 returns 400).
  // All date filtering happens in the answerer, so we must fetch enough records
  // to cover any time period the user might ask about.
  const ALWAYS_FETCH_ALL = new Set([
    'SalesInvoice', 'PurchaseInvoice', 'SalesCrMemo', 'PurchaseCrMemo',
    'GeneralLedgerEntry', 'SalesInvoiceSalesLines', 'PurchaseInvoicePurchLines',
    'SalesOrder', 'PurchaseOrder', 'SalesShipment', 'SalesShipmentLine',
  ])

  const TIME_PERIOD_KEYWORDS = /\b(quarter|month|year|ytd|week|day|last|this|past|period|recent|trend|over|since|between|from|annual|quarterly|monthly|weekly|daily)\b/i

  const forceLargeTop =
    ALWAYS_FETCH_ALL.has(plan.entity) ||
    TIME_PERIOD_KEYWORDS.test(question)

  if (forceLargeTop) {
    const setTop = (params: string, n: number) =>
      /\$top=\d+/i.test(params)
        ? params.replace(/\$top=\d+/i, `$top=${n}`)
        : `$top=${n}&${params}`

    plan.params       = setTop(plan.params ?? '', 1000)
    if (plan.secondParams) plan.secondParams = setTop(plan.secondParams, 2000)
  }

  const odataUrl = buildODataUrl(tenant, plan.entity, plan.params)

  let bcData: any
  let rawRecords: any[]

  try {
    const bcRes = await fetch(odataUrl, {
      headers: {
        'X-BespoxAI-Key': tenant.apiKey,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(30_000),
    })

    if (!bcRes.ok) {
      const errText = await bcRes.text()

      // ── GPT recovery: explain why + suggest better questions ─────────────
      let recoveryAnswer = "Business Central couldn't process that query — the specific filter or field combination isn't supported by this version of BC's OData API."
      let recoverySuggestions: string[] = []

      try {
        const recoveryRes = await openai.chat.completions.create({
          model: 'gpt-4o',
          max_tokens: 600,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: `${PERSONA}

A Business Central v14 OData query returned a 400 Bad Request error. Explain to the CFO in plain language why this specific question couldn't be answered, and suggest 2–3 alternative questions that WILL work.

BC v14 OData limitations to consider:
- Date filtering ($filter on Posting_Date) is not supported on posted documents (SalesInvoice, PurchaseInvoice, SalesCrMemo, GeneralLedgerEntry) — returns 400
- $apply, groupby, aggregate() are not supported — returns 400  
- Boolean fields like "Blocked" may not be filterable on all entities
- Only fields listed in the entity's metadata can be used in $filter or $select

Return JSON:
{
  "reason": "1–2 sentences explaining in plain CFO language why this question couldn't be answered directly, without technical jargon",
  "suggestedQueries": ["alternative question 1", "alternative question 2", "alternative question 3"]
}`,
            },
            {
              role: 'user',
              content: `User question: "${question}"\nOData URL attempted: ${odataUrl}\nBC error: ${errText.slice(0, 300)}`,
            },
          ],
        })

        const raw = recoveryRes.choices[0].message.content ?? '{}'
        const clean = raw.replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim()
        const parsed = JSON.parse(clean)
        recoveryAnswer    = parsed.reason           ?? recoveryAnswer
        recoverySuggestions = parsed.suggestedQueries ?? []
      } catch { /* use defaults */ }

      // ── Log as bad query so it's never repeated ──────────────────────────
      prisma.queryLog.create({
        data: {
          tenantId:    tenant.tenantId,
          userId:      (session.user as any).id,
          question,
          answer:      recoveryAnswer,
          displayHint: 'narrative',
          entity:      '__BAD_QUERY__',
          recordCount: 0,
          data:        { reason: recoveryAnswer, suggestedQueries: recoverySuggestions } as any,
        },
      }).catch(() => {})

      // ── Return friendly response — no raw error shown to user ────────────
      return NextResponse.json({
        answer:          recoveryAnswer,
        displayHint:     'narrative' as DisplayHint,
        data:            null,
        badQuery:        true,
        suggestedQueries: recoverySuggestions,
        meta: { entity: '__BAD_QUERY__', reasoning: 'OData 400 — query not supported', recordCount: 0, odataUrl },
      })
    }

    bcData = await bcRes.json()
    rawRecords = bcData.value ?? (Array.isArray(bcData) ? bcData : [bcData])
  } catch (err: any) {
    return NextResponse.json(
      { error: `BCAgent unreachable: ${err.message}`, odataUrl, plan },
      { status: 502 },
    )
  }

  // ── Step 2b: Fetch + join second entity (optional) ───────────────────────

  if (plan.secondEntity && plan.joinKey && plan.joinForeignKey) {
    const secondUrl = buildODataUrl(tenant, plan.secondEntity, plan.secondParams)
    try {
      const secondRes = await fetch(secondUrl, {
        headers: { 'X-BespoxAI-Key': tenant.apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      })
      if (secondRes.ok) {
        const secondData = await secondRes.json()
        const secondRecords: any[] = secondData.value ?? []

        // Build lookup map: foreignKey → aggregated values from second records
        const lookup = new Map<string, any>()
        for (const rec of secondRecords) {
          const fk = rec[plan.joinForeignKey]
          if (fk == null) continue
          if (!lookup.has(fk)) {
            lookup.set(fk, { ...rec })
          } else {
            // Sum numeric fields across multiple lines for the same document
            const existing = lookup.get(fk)
            for (const [k, v] of Object.entries(rec)) {
              if (typeof v === 'number' && typeof existing[k] === 'number') {
                existing[k] += v
              }
            }
          }
        }

        // Merge second-entity fields into primary records
        rawRecords = rawRecords.map(rec => {
          const pk = rec[plan.joinKey!]
          const joined = lookup.get(pk)
          return joined ? { ...rec, ...joined } : rec
        })
      }
    } catch {
      // Non-fatal — continue with primary records only
    }
  }

  // ── Date filter in TypeScript — authoritative, not left to GPT ──────────
  // If the planner returned a dateFrom/dateTo, filter rawRecords here so GPT
  // only sees records in the requested period. This makes counts deterministic.
  if (plan.dateFrom && plan.dateTo && plan.dateField) {
    const from = new Date(plan.dateFrom).getTime()
    const to   = new Date(plan.dateTo).getTime()
    rawRecords = rawRecords.filter(rec => {
      const val = rec[plan.dateField!]
      if (!val) return false
      const t = new Date(val).getTime()
      return !isNaN(t) && t >= from && t <= to
    })
  }

  // ── Step 3: Answer — Claude produces natural language + structured data ──

  // Truncate huge payloads before sending to Claude (keep first 80 records)
  const recordsForClaude = rawRecords.slice(0, 80)
  const truncated = rawRecords.length > 80

  let payload: AnswerPayload
  try {
    const answerRes = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 2000,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `${PERSONA}

You are presenting live Business Central data to the CFO at ${tenant.name}.
${DATE_CONTEXT}

Your response MUST be a single valid JSON object with this exact shape:
{
  "answer": "...",
  "displayHint": "...",
  "data": { ... } or null
}

─── answer ───────────────────────────────────────────────────────────────────
Write as a trusted financial advisor briefing a CFO. Rules:
- Lead with the key insight or headline number, not a preamble
- Currency: comma-separated with 2 decimal places (e.g. $142,000.00)
- Dates: "15 Jan 2024" format
- Percentages where useful (e.g. "top 3 customers represent 61% of AR")
- Flag anomalies, overdue items, or concentration risk where relevant
- 2–4 sentences for simple answers; up to 8 for complex ones
- No bullet points — flowing, professional prose
${truncated ? `- Data was truncated to 80 of ${rawRecords.length} records` : ''}

─── displayHint ──────────────────────────────────────────────────────────────
Choose exactly one:
- "kpi"        → single headline figure or a small set of KPIs
- "bar_chart"  → ranking / comparison across named categories
- "line_chart" → trend over time
- "table"      → multi-field detail rows where columns matter
- "narrative"  → data doesn't lend itself to a visual

─── data ─────────────────────────────────────────────────────────────────────
kpi:    { "kpis": [{ "label": "Total AR", "value": "$1,234,567.00", "subtext": "across 42 customers" }] }
table / bar_chart: { "columns": ["Customer", "Balance ($)"], "rows": [["Acme Ltd", 142000.00]] }
line_chart: { "columns": ["Month", "Amount ($)"], "rows": [["Jan 2024", 54000]] }
narrative: null
Numbers in rows must be raw numeric — no $ signs or commas.`,
        },
        ...conversationHistory.map(m => ({ role: m.role, content: m.content })),
        {
          role: 'user',
          content: `Question: ${question}\n\nBC data (${recordsForClaude.length} records from ${plan.entity}):\n${JSON.stringify(recordsForClaude, null, 2)}`,
        },
      ],
    })

    const raw = answerRes.choices[0].message.content ?? ''
    _answerResUsage = answerRes.usage as any
    const clean = raw.replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim()
    payload = JSON.parse(clean)

    // Defensive fallbacks
    payload.answer      = payload.answer      ?? 'No answer generated.'
    payload.displayHint = payload.displayHint ?? 'narrative'
    payload.data        = payload.data        ?? null
  } catch (err: any) {
    return NextResponse.json(
      { error: `Answer generation failed: ${err.message}`, step: 'answerer' },
      { status: 500 },
    )
  }

  // ── Persist to QueryLog ───────────────────────────────────────────────────

  try {
    await prisma.queryLog.create({
      data: {
        tenantId:    tenant.tenantId,
        userId:      (session.user as any).id,
        question,
        answer:      payload.answer,
        displayHint: payload.displayHint,
        data:        payload.data ? (payload.data as any) : undefined,
        entity:      plan.entity,
        recordCount: rawRecords.length,
      },
    })
  } catch (e) {
    console.error('[QueryLog save failed]', e)
  }

  // ── Log AI token usage ────────────────────────────────────────────────────

  try {
    const { logAiUsage } = await import('@/lib/ai-usage')
    // Sum tokens across all AI calls in this request (route + answer; rewrite is minor)
    const totalIn  = (_routeResUsage?.prompt_tokens     ?? 0) + (_answerResUsage?.prompt_tokens     ?? 0)
    const totalOut = (_routeResUsage?.completion_tokens ?? 0) + (_answerResUsage?.completion_tokens ?? 0)
    if (totalIn + totalOut > 0) {
      logAiUsage({ tenantId: tenant.tenantId, feature: 'cfo_query', model: 'gpt-4o', inputTokens: totalIn, outputTokens: totalOut })
    }
  } catch { /* non-fatal */ }

  // ── Return ───────────────────────────────────────────────────────────────

  return NextResponse.json({
    answer:      payload.answer,
    displayHint: payload.displayHint,
    data:        payload.data,
    meta: {
      entity:      plan.entity,
      reasoning:   plan.reasoning,
      recordCount: rawRecords.length,
      odataUrl,
    },
  })
}
