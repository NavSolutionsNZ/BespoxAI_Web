import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerSession, assertTenantBelongsToPartner, assertPartnerCanDevelop } from '@/lib/partner-auth'
import { prisma } from '@/lib/db'
import { getTenantById, buildODataUrl } from '@/lib/tenants'
import { getAiConfig } from '@/lib/ai-config'
import { buildTenantContext } from '@/lib/tenant-context'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ─── BC table name → OData entity name map ───────────────────────────────────
// Standard BC OData entity names for common tables
const TABLE_ENTITY_MAP: Record<string, string> = {
  'Item':                    'Item',
  'Item Table':              'Item',
  'Table 27':                'Item',
  'Sales Header':            'SalesOrderEntityBuffer',
  'Table 36':                'SalesOrder',
  'Purchase Header':         'PurchaseOrder',
  'Table 38':                'PurchaseOrder',
  'Customer':                'Customer',
  'Table 18':                'Customer',
  'Vendor':                  'Vendor',
  'Table 23':                'Vendor',
  'G/L Entry':               'GeneralLedgerEntry',
  'General Ledger Entry':    'GeneralLedgerEntry',
  'Table 17':                'GeneralLedgerEntry',
  'Sales Line':              'SalesOrderLine',
  'Table 37':                'SalesOrderLine',
  'Purchase Line':           'PurchaseOrderLine',
  'Table 39':                'PurchaseOrderLine',
  'Job':                     'Job',
  'Table 167':               'Job',
  'Resource':                'Resource',
  'Table 156':               'Resource',
}

// ─── Introspect a BC table's existing fields via OData ───────────────────────
async function introspectBCTable(
  agentBaseUrl: string,
  bcInstance: string,
  bcCompany: string,
  apiKey: string,
  entityName: string,
): Promise<{ fields: string[]; error?: string }> {
  try {
    // Fetch 1 record with all fields — OData returns field names in the response
    const url = `${agentBaseUrl}/${bcInstance}/ODataV4/Company('${encodeURIComponent(bcCompany)}')/${entityName}?$top=1`
    const res = await fetch(url, {
      headers: { 'X-BespoxAI-Key': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      return { fields: [], error: `${res.status} ${res.statusText}` }
    }
    const data = await res.json()
    const record = data?.value?.[0] ?? data
    if (!record || typeof record !== 'object') return { fields: [] }
    // Extract field names (exclude OData metadata keys)
    const fields = Object.keys(record).filter(k => !k.startsWith('@') && k !== 'odata.etag')
    return { fields }
  } catch (e: any) {
    return { fields: [], error: e.message }
  }
}

// ─── Extract table names mentioned in bcObjects from the AI spec ─────────────
function extractTableNames(bcObjects: string[]): string[] {
  const tables: string[] = []
  for (const obj of bcObjects) {
    // Match patterns like "Table 27 Item", "Table 36 Sales Header", plain "Item Table" etc.
    const tableMatch = obj.match(/Table\s+\d+\s+([\w\s\/]+?)(?:\s+[—–-]|\s*$)/i)
      ?? obj.match(/^(Item|Customer|Vendor|Sales Header|Purchase Header|Sales Line|Purchase Line|G\/L Entry|Job|Resource)/i)
    if (tableMatch) {
      const name = tableMatch[1].trim()
      tables.push(name)
    }
  }
  return Array.from(new Set(tables))
}

// ─── Map table name to OData entity ─────────────────────────────────────────
function resolveEntityName(tableName: string): string | null {
  for (const [key, entity] of Object.entries(TABLE_ENTITY_MAP)) {
    if (key.toLowerCase() === tableName.toLowerCase() || tableName.toLowerCase().includes(key.toLowerCase())) {
      return entity
    }
  }
  // Fallback: strip spaces and try directly
  return tableName.replace(/\s+/g, '')
}

const DEV_PLAN_SYSTEM = `You are a senior Microsoft Dynamics 365 Business Central / NAV developer and technical lead with 20+ years experience. You are writing an INTERNAL development plan — not for the customer.

Your plan must allow a developer to start work immediately, support accurate quoting, identify all risks, and define testing/deployment strategy.

CRITICAL FIELD CHECKING: You will be provided with the ACTUAL fields that already exist in the customer's live BC tables. You MUST:
- Check every field you plan to add against the existing field list
- If a field ALREADY EXISTS: do NOT add it to the dev plan — note it as "field already exists, no action needed"
- If a field is MISSING: include it in the dev plan with the correct field number (start from 50000+ for custom fields)
- List which fields were found vs missing in your assumptions section

CRITICAL: For every Development phase task, include a codeSnippet with:
- Exact AL code (or C/AL for NAV/BC14) ready to paste
- Precise object names, field numbers, trigger names matching standard BC objects  
- Placement instructions: which file, which section (fields/triggers/procedures), where to insert

Respond ONLY with valid JSON, no markdown:
{
  "summary": "Technical overview including which fields were found vs needed to be added",
  "approach": "Detailed technical approach — AL patterns, extension architecture, version-specific considerations",
  "tasks": [
    {
      "title": "Task title",
      "description": "Description noting if fields already exist or need adding",
      "objects": ["Table 27 Item — add field 50100 Release_Date (Date) [FIELD MISSING - needs adding]"],
      "estimatedHours": 4,
      "phase": "Development",
      "codeSnippet": {
        "filename": "ItemExt.TableExt.al",
        "placement": "New file in extension project src/ folder",
        "code": "tableextension 50100 ItemExt extends \"Item\"\\n{\\n    fields\\n    {\\n        field(50100; \\\"Release Date\\\"; Date)\\n        {\\n            Caption = 'Release Date';\\n            DataClassification = CustomerContent;\\n        }\\n    }\\n}"
      }
    }
  ],
  "existingFieldsFound": ["List any fields the plan needed that ALREADY EXIST in the live BC tables"],
  "missingFieldsAdded": ["List fields that were confirmed MISSING and are being added by this plan"],
  "totalEstimatedHours": 24,
  "suggestedDailyRate": 1200,
  "quotingNotes": "Internal pricing notes — complexity, margin risks, fixed-price vs T&M, scope creep vectors",
  "risks": ["Risk description — specific mitigation approach"],
  "testingPlan": "Specific test scenarios — unit, integration, UAT. What customer must sign off.",
  "deploymentNotes": "Extension packaging, environment promotion, data migration if needed, rollback plan",
  "assumptions": ["Include: fields found in live BC / fields not found and being added"]
}

Rules:
- codeSnippet REQUIRED for every Development task
- NEVER add a field that already exists in the live table — check the provided field list
- Use exact BC object IDs from standard BC object model
- estimatedHours: include design/thinking time
- suggestedDailyRate in NZD ($1000-$1500/day typical)
- totalEstimatedHours: sum tasks + 15-20% contingency`

// Sanitize AI JSON — fixes literal newlines/tabs inside strings (common in code snippets)
// then closes any unclosed brackets from truncation
function sanitizeDevPlanJSON(raw: string): string {
  // Strip markdown fences
  let s = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim()

  // Pass 1 — replace literal newlines/tabs/carriage returns inside JSON strings
  let sanitized = ''
  let inString = false
  let escape = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (escape) { sanitized += ch; escape = false; continue }
    if (ch === '\\') { sanitized += ch; escape = true; continue }
    if (ch === '"') { inString = !inString; sanitized += ch; continue }
    if (inString) {
      if (ch === '\n') { sanitized += '\\n'; continue }
      if (ch === '\r') { sanitized += '\\r'; continue }
      if (ch === '\t') { sanitized += '\\t'; continue }
    }
    sanitized += ch
  }

  // Pass 2 — close any unclosed brackets from token truncation
  sanitized = sanitized.trim().replace(/,\s*$/, '')
  const stack: string[] = []
  inString = false; escape = false
  for (const ch of sanitized) {
    if (escape) { escape = false; continue }
    if (ch === '\\') { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') stack.push('}')
    else if (ch === '[') stack.push(']')
    else if (ch === '}' || ch === ']') stack.pop()
  }
  if (inString) sanitized += '"'
  return sanitized + stack.reverse().join('')
}

// POST /api/partner/tenants/[id]/requirements/[reqId]/dev-plan
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; reqId: string } }
) {
  const session = await requirePartnerSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await assertTenantBelongsToPartner(params.id, session.partnerAccountId)
  } catch {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  try {
    await assertPartnerCanDevelop(session.partnerAccountId)
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Forbidden' }, { status: 403 })
  }

  const req_data = await (prisma as any).requirement.findFirst({
    where: { id: params.reqId, tenantId: params.id },
    include: { tenant: { select: { id: true, bcInstance: true, name: true } } },
  })
  if (!req_data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // ── BC version lookup ─────────────────────────────────────────────────────
  let bcVersion = 'Business Central (version not specified)'
  try {
    const signup = await (prisma as any).signupRequest.findFirst({
      where: { companyName: { contains: req_data.tenant.name.split(' ')[0] } },
      orderBy: { createdAt: 'desc' },
      select: { bcVersion: true },
    })
    if (signup?.bcVersion) {
      const vMap: Record<string, string> = {
        BC14: 'BC 14 (on-premise, C/AL + AL hybrid)',
        BC15: 'BC 15 (AL extensions)',
        BC20: 'BC 20', BC21: 'BC 21', BC22: 'BC 22',
        BC23: 'BC 23', BC24: 'BC 24', BC25: 'BC 25 (latest)',
        NAV2018: 'NAV 2018 (C/AL)', NAV2017: 'NAV 2017 (C/AL)', NAV2016: 'NAV 2016 (C/AL)',
      }
      bcVersion = vMap[signup.bcVersion] ?? signup.bcVersion
    } else if (req_data.tenant.bcInstance) {
      bcVersion = `Business Central (instance: ${req_data.tenant.bcInstance})`
    }
  } catch { /* use default */ }

  // ── Live BC field introspection ───────────────────────────────────────────
  let fieldInspectionReport = ''
  const tableFieldMap: Record<string, string[]> = {}

  try {
    const tenant = await getTenantById(req_data.tenant.id)
    if (tenant && tenant.tunnelSubdomain) {
      // Extract table names from the AI spec's bcObjects
      let tablesToInspect: string[] = []
      if (req_data.aiSpec) {
        try {
          const spec = JSON.parse(req_data.aiSpec)
          if (spec.bcObjects?.length) {
            tablesToInspect = extractTableNames(spec.bcObjects)
          }
        } catch { /* ignore */ }
      }

      // Always check Item table if the BC area is Inventory/Sales/Purchase
      if (['Inventory', 'Sales', 'Purchase', 'Manufacturing'].includes(req_data.bcArea)) {
        if (!tablesToInspect.some(t => t.toLowerCase().includes('item'))) {
          tablesToInspect.push('Item')
        }
      }

      // Introspect each table
      const introspectionResults: string[] = []
      for (const tableName of tablesToInspect.slice(0, 5)) { // max 5 tables
        const entityName = resolveEntityName(tableName)
        if (!entityName) continue

        const result = await introspectBCTable(
          tenant.agentBaseUrl,
          tenant.bcInstance,
          tenant.bcCompany,
          tenant.apiKey,
          entityName,
        )

        if (result.fields.length > 0) {
          tableFieldMap[tableName] = result.fields
          introspectionResults.push(
            `${tableName} (OData: ${entityName}) — ${result.fields.length} fields found:\n  ${result.fields.join(', ')}`
          )
        } else if (result.error) {
          introspectionResults.push(
            `${tableName} — could not introspect (${result.error}). Assume standard BC fields only.`
          )
        }
      }

      if (introspectionResults.length > 0) {
        fieldInspectionReport = `\n--- LIVE BC FIELD INSPECTION (from customer's connected BC instance) ---\nIMPORTANT: Cross-check ALL planned fields against these lists. Do NOT add fields that already exist.\n\n${introspectionResults.join('\n\n')}`
      }
    }
  } catch (e) {
    console.warn('BC introspection failed:', e)
    // Non-fatal — continue without live field data
  }

  // ── Parse AI spec context ─────────────────────────────────────────────────
  let specContext = ''
  try {
    if (req_data.aiSpec) {
      const spec = JSON.parse(req_data.aiSpec)
      specContext = [
        spec.userStory    ? `User Story: ${spec.userStory}` : '',
        spec.acceptanceCriteria?.length
          ? `Acceptance Criteria:\n${spec.acceptanceCriteria.map((c: string, i: number) => `${i+1}. ${c}`).join('\n')}` : '',
        spec.bcObjects?.length
          ? `BC Objects identified:\n${spec.bcObjects.map((o: string) => `- ${o}`).join('\n')}` : '',
        spec.complexity   ? `Estimated complexity: ${spec.complexity} (~${spec.estimatedDays} days)` : '',
        spec.assumptions?.length ? `Assumptions: ${spec.assumptions.join('; ')}` : '',
        spec.notes        ? `Technical notes: ${spec.notes}` : '',
      ].filter(Boolean).join('\n\n')
    }
  } catch { /* ignore */ }

  // ── Q&A context ───────────────────────────────────────────────────────────
  let qaContext = ''
  try {
    if (req_data.customerAnswers) {
      const qa = JSON.parse(req_data.customerAnswers)
      if (Array.isArray(qa) && qa[0]?.q) {
        qaContext = 'Customer clarifications:\n' + qa.map((p: any, i: number) => `Q${i+1}: ${p.q}\nA${i+1}: ${p.a}`).join('\n\n')
      } else {
        qaContext = `Customer additional context: ${req_data.customerAnswers}`
      }
    }
  } catch {
    if (req_data.customerAnswers) qaContext = `Customer context: ${req_data.customerAnswers}`
  }

  // ── Tenant knowledge context (KB objects, BC env, customisation history) ──
  let tenantContext = ''
  try {
    tenantContext = await buildTenantContext(req_data.tenant.id)
  } catch { /* non-fatal */ }

  const bcConnectionNote = Object.keys(tableFieldMap).length > 0
    ? `Live BC instance connected — field lists retrieved from ${Object.keys(tableFieldMap).join(', ')}`
    : `No live BC field data available — plan based on standard BC schema. Verify fields manually before development.`

  const prompt = [
    `INTERNAL DEVELOPMENT PLAN`,
    `Customer: ${req_data.tenant.name}`,
    `BC Version: ${bcVersion}`,
    `BC Connection: ${bcConnectionNote}`,
    `Area: ${req_data.bcArea} | Priority: ${req_data.priority.replace(/_/g, ' ')}`,
    ``,
    `--- REQUIREMENT ---`,
    `Title: ${req_data.title}`,
    ``,
    `Customer description:`,
    req_data.description,
    qaContext      ? `\n${qaContext}` : '',
    specContext    ? `\n--- FUNCTIONAL SPEC CONTEXT ---\n${specContext}` : '',
    fieldInspectionReport,
    tenantContext ? `\n--- TENANT KNOWLEDGE BASE (known BC objects, customisation history) ---\n${tenantContext}` : '',
    ``,
    `Generate a detailed internal development plan. Check EVERY planned field against the live BC field lists above before including it.`,
  ].filter(Boolean).join('\n')

  let plan: object
  try {
    const cfg = await getAiConfig()
    const apiKey = cfg.provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error(`No API key for provider "${cfg.provider}"`)

    let raw = ''
    if (cfg.provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: cfg.model, max_tokens: Math.max(cfg.maxTokens, 4000), temperature: cfg.temperature, system: DEV_PLAN_SYSTEM, messages: [{ role: 'user', content: prompt }] }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error?.message ?? `Anthropic error ${res.status}`)
      raw = d.content?.[0]?.text ?? ''
      const { logAiUsage } = await import('@/lib/ai-usage')
      logAiUsage({ tenantId: req_data.tenant.id, requirementId: params.reqId, feature: 'dev_plan', model: cfg.model, inputTokens: d.usage?.input_tokens ?? 0, outputTokens: d.usage?.output_tokens ?? 0 })
    } else {
      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: cfg.model, temperature: cfg.temperature, max_tokens: cfg.maxTokens, messages: [{ role: 'system', content: DEV_PLAN_SYSTEM }, { role: 'user', content: prompt }] }),
      })
      if (!openaiRes.ok) { const err = await openaiRes.json(); throw new Error(err.error?.message ?? `OpenAI error ${openaiRes.status}`) }
      const completion = await openaiRes.json()
      raw = completion.choices?.[0]?.message?.content ?? ''
      const { logAiUsage } = await import('@/lib/ai-usage')
      logAiUsage({ tenantId: req_data.tenant.id, requirementId: params.reqId, feature: 'dev_plan', model: cfg.model, inputTokens: completion.usage?.prompt_tokens ?? 0, outputTokens: completion.usage?.completion_tokens ?? 0 })
    }
    if (!raw) throw new Error('Empty response from AI')
    const cleaned = sanitizeDevPlanJSON(raw)
    try {
      plan = JSON.parse(cleaned)
    } catch {
      // Last resort — try trimming to last complete top-level value
      const lastBrace = cleaned.lastIndexOf('}')
      plan = JSON.parse(cleaned.slice(0, lastBrace + 1))
    }
  } catch (err: any) {
    console.error('Dev plan generation failed:', err)
    return NextResponse.json({ error: err.message ?? 'AI generation failed. Please try again.' }, { status: 500 })
  }

  // Store plan + which tables were introspected for audit
  const planWithMeta = {
    ...plan,
    _introspectedTables: Object.keys(tableFieldMap),
    _bcConnected: Object.keys(tableFieldMap).length > 0,
  }

  await (prisma as any).requirement.update({
    where: { id: params.reqId },
    data: { devPlan: JSON.stringify(planWithMeta) },
    select: { id: true },
  })

  return NextResponse.json({ devPlan: planWithMeta })
}
