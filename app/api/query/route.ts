import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getTenantById, buildODataUrl } from '@/lib/tenants'
import { buildCatalogue, catalogueSummary } from '@/lib/bc-entities'
import { parseAnswerPayload } from '@/lib/answer-format'
import { sanitizeAggSpec, aggregateRecords, describeAggregate, aggregateDisplayData, withGroupNames, NAME_SOURCES, unnamedGroupKeys, applyGroupNames, noFilter, disambiguateLabels, type AggResult } from '@/lib/query-aggregate'
import { getTenantMetadata } from '@/lib/bc-metadata'
import { checkPlanFields, ensureSelected, withNameFields } from '@/lib/odata-fields'
import { prisma } from '@/lib/db'
import { checkTierAccess, checkTokenLimit } from '@/lib/tier'
import { getAiConfig } from '@/lib/ai-config'
import { UPSTREAM_FAILED } from '@/lib/http-status'

export const dynamic = 'force-dynamic'
export const maxDuration = 60


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
  aggregate?: unknown     // totals to compute in code — see lib/query-aggregate.ts (sanitised)
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

  // 2b. Token limit gate — block if monthly allowance exhausted
  const tokenStatus = await checkTokenLimit(session.user.tenantId)
  if (!tokenStatus.allowed) {
    return NextResponse.json(
      { error: 'token_limit_reached', used: tokenStatus.used, limit: tokenStatus.limit, tier: tokenStatus.tier },
      { status: 429 }
    )
  }

  // 2c. Load AI config from DB
  const cfg    = await getAiConfig()
  const apiKey = cfg.provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY
  if (!apiKey) return NextResponse.json({ error: `No API key configured for provider "${cfg.provider}"` }, { status: 503 })
  const openaiClient = cfg.provider === 'openai' ? new OpenAI({ apiKey }) : null

  // Unified AI call — works for both Anthropic and OpenAI, returns { content, usage }
  async function callAI(messages: { role: string; content: string }[], opts: { maxTokens?: number; jsonMode?: boolean } = {}) {
    const maxTok = opts.maxTokens ?? cfg.maxTokens
    if (cfg.provider === 'anthropic') {
      const sys  = messages.find(m => m.role === 'system')?.content
      const msgs = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
      const res  = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey!, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: cfg.model, max_tokens: maxTok, temperature: cfg.temperature, ...(sys ? { system: sys } : {}), messages: msgs }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error?.message ?? `Anthropic ${res.status}`)
      return { content: d.content?.[0]?.text ?? '', usage: { prompt_tokens: d.usage?.input_tokens ?? 0, completion_tokens: d.usage?.output_tokens ?? 0 } }
    } else {
      const res = await openaiClient!.chat.completions.create({
        model: cfg.model, max_tokens: maxTok, temperature: cfg.temperature,
        ...(opts.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
        messages: messages as any,
      })
      return { content: res.choices[0]?.message?.content ?? '', usage: { prompt_tokens: res.usage?.prompt_tokens ?? 0, completion_tokens: res.usage?.completion_tokens ?? 0 } }
    }
  }
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
      const rewriteRes = await callAI([
          {
            role: 'system',
            content: 'You are a query resolver for a Business Central CFO assistant. Given a conversation and a follow-up question containing pronouns or references to previous results, rewrite it as a complete standalone question with all necessary context. Output ONLY the rewritten question — nothing else. If already standalone, output it unchanged.',
          },
          ...conversationHistory,
          { role: 'user', content: 'Follow-up to rewrite: "' + question + '"' },
        ],
      )
      const rewritten = rewriteRes.content.trim() || question
      if (rewritten && rewritten.length > 3) resolvedQuestion = rewritten
    } catch { /* fall back to original */ }
  }

  // 3. Load tenant config
  const tenant = await getTenantById(session.user.tenantId)
  const userDisplayName = (session.user as any).preferredName?.trim() || (session.user as any).firstName?.trim() || null
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not configured' }, { status: 404 })
  }

  // ── Load known bad queries for this tenant ───────────────────────────────
  // These previously caused BC OData 400s — we use them to steer the classifier
  // away from repeating the same mistakes, and exclude them from suggestions.
  let badQueryQuestions: string[] = []
  try {
    const badLogs = await prisma.queryLog.findMany({
      // Recent ones only: what failed weeks ago (e.g. before a service was
      // published, or while the agent was broken) shouldn't block questions forever.
      where: { tenantId: tenant.tenantId, entity: '__BAD_QUERY__', createdAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) } },
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
    const routeRes = await callAI([
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
      { jsonMode: true },
    )

    const routeRaw  = routeRes.content || '{}'
    _routeResUsage  = routeRes.usage
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

  // Only entities this tenant actually publishes (BespoxAI_ services from the
  // installer, or the standard names), with the fields its pages expose. The
  // planner works with logical names; they're mapped to OData names below.
  const tenantMeta = await getTenantMetadata(tenant)
  const catalogue = buildCatalogue(tenantMeta, tenant.entityConfig)
  if (catalogue.length === 0) {
    return NextResponse.json({
      error: 'No Business Central data is published for BespoxAI yet. Re-run the latest BespoxAI installer, which publishes the web services it needs, or ask your administrator to enable them under Settings → Data Entities.',
      step: 'planner',
    }, { status: 400 })
  }

  let plan: QueryPlan
  try {
    const planRes = await callAI([
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
  - aggregate (optional, but REQUIRED whenever the answer needs a total, count, average, min/max, or per-group/per-period sums):
      { "groupBy": field or null, "period": "month"|"quarter"|"year" or null (when groupBy is a date field),
        "labelField": display-name field for the group or null (e.g. "Customer_Name" when grouping by "Customer_No"),
        "measures": [{ "field": "Remaining_Amt_LCY", "op": "sum"|"count"|"avg"|"min"|"max", "label": "Overdue ($)", "negate": false }],
        "sort": "desc"|"asc"|"key", "top": number or null }
    The server computes these exactly over ALL fetched records (after any join and date filter); the answerer never adds numbers up.
    Every field used in aggregate must also be in $select. Use "negate": true for vendor ledger amounts owed (they are negative).

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

Example — overdue debtors by customer (exact total + ranking):
{
  "entity": "CustLedgerEntry",
  "params": "$filter=Open eq true and Due_Date lt <today>&$select=Entry_No,Customer_No,Customer_Name,Due_Date,Remaining_Amt_LCY",
  "aggregate": { "groupBy": "Customer_No", "labelField": "Customer_Name", "measures": [{ "field": "Remaining_Amt_LCY", "op": "sum", "label": "Overdue ($)" }], "sort": "desc", "top": 15 },
  "reasoning": "Open customer entries past due, summed per customer in code"
}
Example — bank balances: entity BankAccountLedgerEntry, $select=Entry_No,Bank_Account_No,Amount_LCY, aggregate groupBy "Bank_Account_No", measure sum of Amount_LCY.
Example — revenue by month: the SalesInvoice + SalesInvoiceSalesLines join, aggregate groupBy "Posting_Date", period "month", measure sum of "Amount".

Available entities:
${catalogueSummary(catalogue)}

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
      { jsonMode: true },
    )

    const planText = planRes.content
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

  const setTop = (params: string, n: number) =>
    /\$top=\d+/i.test(params)
      ? params.replace(/\$top=\d+/i, '$top=' + n)
      : '$top=' + n + '&' + params

  if (forceLargeTop) {
    plan.params       = setTop(plan.params ?? '', 1000)
    if (plan.secondParams) plan.secondParams = setTop(plan.secondParams, 2000)
  }

  // Totals are computed in code over every record, so fetch them all (up to a cap).
  let aggSpec = sanitizeAggSpec(plan.aggregate)
  const AGG_TOP = 5000
  if (aggSpec) {
    // Grouping by Customer_No etc.: fetch and show the name, not just the number.
    const primaryEntitySet = catalogue.find(c => c.logical === plan.entity)?.entitySet
    const fields = (primaryEntitySet && tenantMeta?.fields[primaryEntitySet]?.length)
      ? tenantMeta.fields[primaryEntitySet]
      : catalogue.find(c => c.logical === plan.entity)?.fields ?? []
    const named = withGroupNames(plan.params ?? '', aggSpec, fields)
    aggSpec = named.spec
    // The fields being totalled or grouped must be fetched.
    plan.params = ensureSelected(named.params, [aggSpec.groupBy, ...aggSpec.measures.map(m => m.field)], fields)
    plan.params = setTop(plan.params ?? '', AGG_TOP)
    if (plan.secondParams) plan.secondParams = setTop(plan.secondParams, AGG_TOP * 2)
  }

  // The planner may only use entities in this tenant's catalogue: published in
  // BC and not switched off by the tenant admin (Settings → Data Entities).
  const entitySetFor = (e?: string) => catalogue.find(c => c.logical === e)?.entitySet
  const primarySet = entitySetFor(plan.entity)
  const secondSet  = plan.secondEntity ? entitySetFor(plan.secondEntity) : undefined
  if (!primarySet || (plan.secondEntity && !secondSet)) {
    return NextResponse.json({ error: 'That data is not available for this company.', step: 'planner' }, { status: 400 })
  }

  // Check the planner's fields against the page's real ones before asking BC.
  // Unknown $select/$orderby fields are dropped; an unknown $filter field means
  // the planner invented it — reply without recording a "bad query", since the
  // question itself is fine.
  const actualFor = (set?: string) => (set && tenantMeta?.fields[set]?.length ? tenantMeta.fields[set] : null)
  const primaryCheck = checkPlanFields(plan.params ?? '', actualFor(primarySet))
  plan.params = withNameFields(primaryCheck.params, actualFor(primarySet))
  const secondCheck = plan.secondParams ? checkPlanFields(plan.secondParams, actualFor(secondSet)) : null
  if (secondCheck) plan.secondParams = secondCheck.params
  // Shape of the plan only (no values) — for diagnosing planner behaviour.
  console.log('[query] plan', JSON.stringify({
    entity: plan.entity, second: plan.secondEntity ?? null,
    aggregate: aggSpec ? { groupBy: aggSpec.groupBy, period: aggSpec.period, labelField: aggSpec.labelField, measures: aggSpec.measures.map(m => m.op + ':' + (m.field ?? '')) } : null,
    select: (/\$select=([^&]*)/i.exec(plan.params ?? '')?.[1] ?? '*'),
    droppedFields: primaryCheck.dropped,
  }))
  const unknownFilterFields = [...primaryCheck.unknownInFilter, ...(secondCheck?.unknownInFilter ?? [])]
  if (unknownFilterFields.length) {
    return NextResponse.json({
      answer: 'I tried to filter on ' + (unknownFilterFields.length === 1 ? 'a field' : 'fields') + ' that ' + plan.entity +
        ' doesn\'t have (' + unknownFilterFields.join(', ') + '), so I didn\'t run the query. Please ask again — naming the customer, vendor or period you mean usually helps.',
      displayHint: 'narrative' as DisplayHint,
      data: null,
      suggestedQueries: [],
      meta: { entity: plan.entity, reasoning: 'Planner used unknown filter fields: ' + unknownFilterFields.join(', '), recordCount: 0, odataUrl: null },
    })
  }

  const odataUrl = buildODataUrl(tenant, primarySet, plan.params)

  let bcData: any
  let rawRecords: any[]
  let fetchedCount = 0

  try {
    const bcRes = await fetch(odataUrl, {
      headers: {
        'X-BespoxAI-Key': tenant.apiKey,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(30_000),
    })

    // Only a 400 means BC couldn't handle the query itself. Anything else (agent
    // down, 401, 404, 503) is a connection problem: say so, and don't record the
    // question as a bad query — that list steers the router away from it.
    if (!bcRes.ok && bcRes.status !== 400) {
      const detail = (await bcRes.text().catch(() => '')).slice(0, 300)
      return NextResponse.json({
        error: 'Business Central didn\'t answer (HTTP ' + bcRes.status + '). Check that the BespoxAI Agent is running and try again.',
        detail, step: 'fetch',
      }, { status: UPSTREAM_FAILED })
    }

    if (!bcRes.ok) {
      const errText = await bcRes.text()

      // ── GPT recovery: explain why + suggest better questions ─────────────
      let recoveryAnswer = "Business Central couldn't process that query — the specific filter or field combination isn't supported by this version of BC's OData API."
      let recoverySuggestions: string[] = []

      try {
        const recoveryRes = await callAI([
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
        )

        const raw = recoveryRes.content || '{}'
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
    fetchedCount = rawRecords.length
  } catch (err: any) {
    return NextResponse.json(
      { error: `BCAgent unreachable: ${err.message}`, odataUrl, plan },
      { status: UPSTREAM_FAILED },
    )
  }

  // ── Step 2b: Fetch + join second entity (optional) ───────────────────────

  if (plan.secondEntity && plan.joinKey && plan.joinForeignKey) {
    const secondUrl = buildODataUrl(tenant, secondSet!, plan.secondParams)
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

  // ── Step 2c: Exact totals in code (when the planner asked for them) ──────
  let agg: AggResult | null = null
  let aggIncomplete = false
  if (aggSpec) {
    agg = aggregateRecords(rawRecords, aggSpec)
    aggIncomplete = fetchedCount >= AGG_TOP
    // Groups still labelled only by their No. (ledger name fields are blank on
    // older entries): look the names up on the customer/vendor/item record.
    const src = aggSpec.groupBy && !aggSpec.period ? NAME_SOURCES[aggSpec.groupBy] : undefined
    const masterSet = src ? catalogue.find(c => c.logical === src.logical)?.entitySet : undefined
    const missing = agg ? unnamedGroupKeys(agg).slice(0, 50) : []
    if (src && masterSet && missing.length) {
      try {
        const url = buildODataUrl(tenant, masterSet, '$top=' + missing.length + '&$select=No,' + src.nameField + '&$filter=' + encodeURIComponent(noFilter(missing)))
        const r = await fetch(url, { headers: { 'X-BespoxAI-Key': tenant.apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
        if (r.ok) {
          const rows: any[] = (await r.json())?.value ?? []
          applyGroupNames(agg, new Map(rows.map(x => [String(x.No ?? ''), String(x[src.nameField] ?? '')])), src.logical === 'Item' ? 'Item' : src.logical === 'BankAccount' ? 'Bank account' : src.logical)
        }
      } catch { /* names are a nicety — keep the numbers */ }
    }
    if (agg) disambiguateLabels(agg)
  }

  // ── Step 3: Answer — Claude produces natural language + structured data ──

  // Truncate huge payloads before sending to Claude. With exact totals the
  // records are only context, so fewer are needed.
  const recordLimit = agg ? 30 : 80
  const recordsForClaude = rawRecords.slice(0, recordLimit)
  const truncated = rawRecords.length > recordLimit

  let payload: AnswerPayload
  try {
    const answerRes = await callAI([
        {
          role: 'system',
          content: `${PERSONA}

You are presenting live Business Central data to the CFO at ${tenant.name}.${userDisplayName ? ' Address them by name: ' + userDisplayName + '.' : ''}
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
${truncated ? (agg ? '- Only ' + recordLimit + ' of ' + rawRecords.length + ' records are shown as examples; the EXACT FIGURES block covers all of them' : '- Data was truncated to ' + recordLimit + ' of ' + rawRecords.length + ' records') : ''}
${agg ? '- An EXACT FIGURES block is provided: every number in your answer must come from it. Never compute totals, averages or counts yourself.' : ''}

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
Numbers in rows must be raw numeric — no $ signs or commas.
Identifiers are text, not numbers: document, invoice, entry, account and item numbers and codes stay strings exactly as in the data (e.g. "103027", "2910").`,
        },
        ...conversationHistory.map(m => ({ role: m.role, content: m.content })),
        {
          role: 'user',
          content: 'Question: ' + question + '\n\n' + (agg ? describeAggregate(agg, aggIncomplete) + '\n\n' : '') +
            'BC data (' + recordsForClaude.length + ' of ' + rawRecords.length + ' records from ' + plan.entity + '):\n' + JSON.stringify(recordsForClaude, null, 2),
        },
      ],
      { jsonMode: true },
    )

    _answerResUsage = answerRes.usage
    // Tolerates fenced/wrapped JSON; prose-only replies become a narrative answer
    payload = parseAnswerPayload(answerRes.content) as AnswerPayload
    // Charts, tables and KPIs show the computed figures, not the model's copy of them.
    if (agg) {
      const exact = aggregateDisplayData(agg, payload.displayHint)
      if (exact) payload.data = exact
    }
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
      logAiUsage({ tenantId: tenant.tenantId, feature: 'cfo_query', model: cfg.model, inputTokens: totalIn, outputTokens: totalOut })
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
      aggregated:  agg ? true : undefined,
      incomplete:  aggIncomplete || undefined,
    },
  })
}
