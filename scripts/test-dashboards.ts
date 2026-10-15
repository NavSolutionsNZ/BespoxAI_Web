/**
 * Tests for the dashboard metric engine. Run: npx tsx scripts/test-dashboards.ts
 * No database or BC connection needed — the FlowFilter source runs against a fake fetcher.
 */
import assert from 'node:assert/strict'
import { METRICS, agingBucket } from '../lib/dashboards/registry'
import { DEFAULT_CFO_PACK } from '../lib/dashboards/default-pack'
import { validateSpec } from '../lib/dashboards/validate'
import { resolvePeriod, resolveCompare, monthBuckets } from '../lib/dashboards/periods'
import { fetchMetric, tenantToday } from '../lib/dashboards/executor'
import { mockSource } from '../lib/dashboards/sources/mock'
import { createFlowFilterSource as createFF, loadFiscalCalendar, tunnelNextLink, type JsonFetcher } from '../lib/dashboards/sources/flowfilter'
import { MetricSourceError } from '../lib/dashboards/types'
import { optKey, BC_SERVICES } from '../lib/dashboards/bc-services'
import { applyAiReply, buildSystemPrompt, describeLayout } from '../lib/dashboards/ai-edit'
import { addSection, addWidget, moveWidget, removeSection, removeWidget, renameSection, tidy, updateWidget } from '../lib/dashboards/edit'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TenantConfig } from '../lib/tenants'

// Mirrors lib/tenants buildODataUrl (that module loads Prisma, which tests avoid).
const buildUrl = (t: TenantConfig, entity: string, params?: string) => {
  const base = t.agentBaseUrl + '/' + t.bcInstance + "/ODataV4/Company('" + t.bcCompany + "')/" + entity
  return params ? base + '?' + params : base
}
const createFlowFilterSource = (t: TenantConfig, fetcher: JsonFetcher) => createFF(t, { fetcher, buildUrl })

let passed = 0
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; console.log('  ✓ ' + name) }
  catch (e) { console.error('  ✗ ' + name); throw e }
}

const tenant: TenantConfig = {
  tenantId: 't1', name: 'Acme', tunnelSubdomain: 'acme', bcInstance: 'NAV', bcCompany: 'CRONUS',
  apiKey: 'k', agentBaseUrl: 'https://acme-agent.bespoxai.com', entityConfig: null, country: 'NZ',
  navProduct: null, navVersion: null, lastCU: null, bcPort: 7048, agentPort: 9099,
}

function fakeFetcher(handler: (url: string) => { status?: number; body?: any; text?: string }): JsonFetcher & { urls: string[] } {
  const urls: string[] = []
  const f = (async (url: string) => {
    urls.push(url)
    const r = handler(url)
    const status = r.status ?? 200
    return { ok: status < 400, status, json: async () => r.body, text: async () => r.text ?? '' }
  }) as JsonFetcher & { urls: string[] }
  f.urls = urls
  return f
}

const today = new Date(2026, 9, 13) // 13 Oct 2026
const opts = { today }

async function main() {
  console.log('Registry & spec')
  await test('every metric is implemented by mock and flowfilter sources', () => {
    const ff = createFlowFilterSource(tenant, fakeFetcher(() => ({ body: { value: [] } })))
    for (const id of Object.keys(METRICS)) {
      assert.ok(mockSource.implements(id), 'mock missing ' + id)
      assert.ok(ff.implements(id), 'flowfilter missing ' + id)
    }
  })
  await test('default CFO pack validates', () => {
    const r = validateSpec(DEFAULT_CFO_PACK)
    assert.ok(r.ok, JSON.stringify(r))
  })
  await test('bad specs are rejected', () => {
    const bad = structuredClone(DEFAULT_CFO_PACK) as any
    bad.sections[0].widgets[0].metricId = 'made_up'
    bad.sections[0].widgets[1].type = 'line'                     // kpi metric on a line chart
    bad.sections[1].widgets[0].params = { period: 'ytd' }         // cash_total takes no period
    bad.sections[2].widgets[0].id = 'pl-rev'                      // duplicate id
    const r = validateSpec(bad)
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.errors.length, 4, r.errors.join('\n'))
  })

  console.log('Periods')
  await test('this_month / last_month / quarters', () => {
    assert.deepEqual([resolvePeriod('this_month', today).from, resolvePeriod('this_month', today).to], ['2026-10-01', '2026-10-31'])
    assert.deepEqual([resolvePeriod('last_month', today).from, resolvePeriod('last_month', today).to], ['2026-09-01', '2026-09-30'])
    assert.deepEqual([resolvePeriod('last_quarter', today).from, resolvePeriod('last_quarter', today).to], ['2026-07-01', '2026-09-30'])
    const jan = new Date(2026, 0, 5)
    assert.deepEqual([resolvePeriod('last_quarter', jan).from, resolvePeriod('last_quarter', jan).to], ['2025-10-01', '2025-12-31'])
  })
  await test('YTD / last year follow NAV fiscal-year starts', () => {
    const april = { starts: ['2024-04-01', '2025-04-01', '2026-04-01', '2027-04-01'], source: 'nav' as const }
    assert.equal(resolvePeriod('ytd', today).from, '2026-01-01')                       // no NAV data → calendar
    assert.equal(resolvePeriod('ytd', today, april).from, '2026-04-01')
    assert.deepEqual([resolvePeriod('last_year', today, april).from, resolvePeriod('last_year', today, april).to], ['2025-04-01', '2026-03-31'])
    assert.equal(resolvePeriod('ytd', new Date(2026, 1, 1), april).from, '2025-04-01')
    // Short first year after incorporation: last year is the real (short) year, not 12 months
    const short = { starts: ['2025-10-01', '2026-04-01'], source: 'nav' as const }
    assert.deepEqual([resolvePeriod('last_year', today, short).from, resolvePeriod('last_year', today, short).to], ['2025-10-01', '2026-03-31'])
    // Only the current year set up in NAV: previous year assumed 12 months
    const one = { starts: ['2026-04-01'], source: 'nav' as const }
    assert.equal(resolvePeriod('last_year', today, one).from, '2025-04-01')
    // NAV periods all in the future → calendar
    assert.equal(resolvePeriod('ytd', today, { starts: ['2030-01-01'], source: 'nav' }).from, '2026-01-01')
  })
  await test('prior period for whole months; prior year', () => {
    const p = resolvePeriod('this_month', new Date(2026, 2, 10)) // March
    assert.deepEqual([resolveCompare(p, 'prior_period')!.from, resolveCompare(p, 'prior_period')!.to], ['2026-02-01', '2026-02-28'])
    const q = resolvePeriod('this_quarter', today)
    assert.deepEqual([resolveCompare(q, 'prior_period')!.from, resolveCompare(q, 'prior_period')!.to], ['2026-07-01', '2026-09-30'])
    assert.equal(resolveCompare(p, 'prior_year')!.from, '2025-03-01')
    assert.equal(resolveCompare(p, 'none'), undefined)
  })
  await test('month buckets: 12, oldest first, ending this month', () => {
    const b = monthBuckets(12, today)
    assert.equal(b.length, 12)
    assert.equal(b[0].from, '2025-11-01')
    assert.equal(b[11].to, '2026-10-31')
  })
  await test('aging buckets', () => {
    assert.equal(agingBucket('2026-10-13', today), 'Not due')
    assert.equal(agingBucket('2026-10-12', today), '1–30')
    assert.equal(agingBucket('2026-08-14', today), '31–60')
    assert.equal(agingBucket('2026-06-01', today), '90+')
  })
  await test('tenantToday uses tenant time zone', () => {
    const utc = new Date(Date.UTC(2026, 9, 13, 12, 0)) // 13 Oct 12:00 UTC = 14 Oct 01:00 NZDT
    assert.equal(tenantToday('NZ', utc).getDate(), 14)
    assert.equal(tenantToday('GB', utc).getDate(), 13)
  })

  console.log('Mock source')
  await test('every metric returns its declared kind', async () => {
    for (const def of Object.values(METRICS)) {
      const r = await fetchMetric(mockSource, def.id, undefined, opts)
      assert.equal(r.kind, def.kind, def.id)
      assert.ok(r[def.kind], def.id + ' missing ' + def.kind + ' payload')
    }
  })
  await test('mock data is deterministic', async () => {
    const a = await fetchMetric(mockSource, 'pl_summary', undefined, opts)
    const b = await fetchMetric(mockSource, 'pl_summary', undefined, opts)
    assert.deepEqual(a.breakdown, b.breakdown)
  })

  console.log('FlowFilter source')
  const gl = [
    { No: '6110', Account_Type: 'Posting', Income_Balance: 'Income_Statement', Account_Category: 'Income', Net_Change: -100_000 },
    { No: '6120', Account_Type: 'Posting', Income_Balance: 'Income Statement', Account_Category: 'Income', Net_Change: -20_000 },
    { No: '6195', Account_Type: 'Total', Income_Balance: 'Income Statement', Account_Category: 'Income', Net_Change: -120_000 }, // totalling — ignored
    { No: '7110', Account_Type: 'Posting', Income_Balance: 'Income Statement', Account_Category: 'Cost_x0020_of_x0020_Goods_x0020_Sold', Net_Change: 70_000 },
    { No: '8110', Account_Type: 'Posting', Income_Balance: 'Income Statement', Account_Category: 'Expense', Net_Change: 30_000 },
    { No: '2910', Account_Type: 'Posting', Income_Balance: 'Balance Sheet', Account_Category: 'Assets', Net_Change: 999_999 }, // balance sheet — ignored
  ]
  await test('option values normalise across encodings', () => {
    assert.equal(optKey('Cost_x0020_of_x0020_Goods_x0020_Sold'), 'costofgoodssold')
    assert.equal(optKey('Income_Statement'), optKey('Income Statement'))
  })
  await test('P&L: signs, categories, posting-only, Date_Filter in URL', async () => {
    const f = fakeFetcher(() => ({ body: { value: gl } }))
    const src = createFlowFilterSource(tenant, f)
    const rev = await fetchMetric(src, 'pl_revenue', { period: 'this_month', compare: 'none' }, opts)
    assert.equal(rev.scalar!.value, 120_000)
    const gm = await fetchMetric(src, 'pl_gross_margin', { compare: 'none' }, opts)
    assert.equal(gm.scalar!.value, 50_000)
    const np = await fetchMetric(src, 'pl_net_profit', { compare: 'none' }, opts)
    assert.equal(np.scalar!.value, 20_000)
    const u = decodeURIComponent(f.urls[0])
    assert.ok(u.includes('/BespoxAI_GLAccounts?'), u)
    assert.ok(u.includes("Date_Filter eq '2026-10-01..2026-10-31'"), u)   // BC14: Date_Filter is a string
    assert.ok(!rev.provenance.calls[0].includes('acme-agent'), 'tunnel host must be stripped from provenance')
  })
  await test('P&L with comparison makes two calls', async () => {
    const f = fakeFetcher(() => ({ body: { value: gl } }))
    const r = await fetchMetric(createFlowFilterSource(tenant, f), 'pl_summary', { compare: 'prior_period' }, opts)
    assert.equal(f.urls.length, 2)
    assert.ok(decodeURIComponent(f.urls[1]).includes('2026-09-01'))
    assert.equal(r.breakdown!.rows.find(x => x.label === 'Net profit')!.extra!.compare, 20_000)
  })
  await test('no Account Category → clear field_not_available error', async () => {
    const f = fakeFetcher(() => ({ body: { value: gl.map(r => ({ ...r, Account_Category: '' })) } }))
    await assert.rejects(fetchMetric(createFlowFilterSource(tenant, f), 'pl_revenue', undefined, opts),
      (e: any) => e instanceof MetricSourceError && e.code === 'field_not_available')
  })
  await test('unpublished service → service_not_published', async () => {
    const f = fakeFetcher(() => ({ status: 404 }))
    await assert.rejects(fetchMetric(createFlowFilterSource(tenant, f), 'cash_total', undefined, opts),
      (e: any) => e instanceof MetricSourceError && e.code === 'service_not_published')
  })
  await test('bank accounts that share a name are told apart by No.', async () => {
    const entries = [{ Bank_Account_No: 'WWB-OP', Amount_LCY: 10 }, { Bank_Account_No: 'WWB-USD', Amount_LCY: 5 }, { Bank_Account_No: 'NBA', Amount_LCY: 1 }]
    const accounts = [{ No: 'WWB-OP', Name: 'World Wide Bank' }, { No: 'WWB-USD', Name: 'World Wide Bank' }, { No: 'NBA', Name: 'New Bank of Auckland' }]
    const f = fakeFetcher(url => ({ body: { value: url.includes('/BespoxAI_BankAccounts?') ? accounts : entries } }))
    const r = await fetchMetric(createFlowFilterSource(tenant, f), 'cash_by_account', undefined, opts)
    assert.deepEqual(r.breakdown!.rows.map(x => x.label), ['World Wide Bank (WWB-OP)', 'World Wide Bank (WWB-USD)', 'New Bank of Auckland'])
  })
  await test('nextLink is re-pointed at the tunnel; other paths are refused', async () => {
    // BC names its own address in nextLink — the portal must go through the tunnel instead.
    const bcNext = "http://localhost:7048/NAV/ODataV4/Company('CRONUS')/BespoxAI_BankLedgerEntries?$skiptoken=2"
    const f = fakeFetcher(url => url.includes('skiptoken')
      ? { body: { value: [{ Bank_Account_No: 'B', Amount_LCY: 50 }] } }
      : { body: { value: [{ Bank_Account_No: 'A', Amount_LCY: 100 }], '@odata.nextLink': bcNext } })
    const r = await fetchMetric(createFlowFilterSource(tenant, f), 'cash_total', undefined, opts)
    assert.equal(r.scalar!.value, 150)
    assert.equal(f.urls.length, 2)
    assert.ok(f.urls[1].startsWith(tenant.agentBaseUrl + "/NAV/ODataV4/Company('CRONUS')/"), f.urls[1])
    assert.equal(tunnelNextLink(tenant, 'https://evil.example.com/NAV/ODataV4/../../bespoxai/update-config'), null)
    assert.equal(tunnelNextLink(tenant, 'https://evil.example.com/x'), null)
    assert.equal(tunnelNextLink(tenant, "http://localhost:7048/NAV/ODataV4/Company('X')/../../../bespoxai/diagnose"), null)
    assert.ok(tunnelNextLink(tenant, 'https://evil.example.com/NAV/ODataV4/Company(\'X\')/Y')!.startsWith(tenant.agentBaseUrl + '/'))
  })
  await test('full pages continue with $skip until a short page', async () => {
    const full = Array.from({ length: 5000 }, () => ({ Bank_Account_No: 'A', Amount_LCY: 1 }))
    const f = fakeFetcher(url => ({ body: { value: url.includes('$skip=5000') ? [{ Bank_Account_No: 'A', Amount_LCY: 7 }] : full } }))
    const r = await fetchMetric(createFlowFilterSource(tenant, f), 'cash_total', undefined, opts)
    assert.equal(r.scalar!.value, 5007)
    assert.equal(f.urls.length, 2)
    assert.equal(r.provenance.truncated, false)
  })
  await test('Date_Filter falls back to ge/le when BC types it as a date, and remembers', async () => {
    const t2 = { ...tenant, tenantId: 'dateTyped' }
    const f = fakeFetcher(url => decodeURIComponent(url).includes("Date_Filter eq '")
      ? { status: 400, text: '{"error":{"message":"A binary operator with incompatible types was detected. Found operand types \'Edm.Date\' and \'Edm.String\'"}}' }
      : { body: { value: gl } })
    const r = await fetchMetric(createFlowFilterSource(t2, f), 'pl_revenue', { compare: 'none' }, opts)
    assert.equal(r.scalar!.value, 120_000)
    assert.ok(decodeURIComponent(f.urls[1]).includes('Date_Filter ge 2026-10-01 and Date_Filter le 2026-10-31'))
    await fetchMetric(createFlowFilterSource(t2, f), 'pl_revenue', { compare: 'none' }, opts)
    assert.equal(f.urls.length, 3, 'second metric should use the learnt form straight away')
  })
  await test('cash comes from bank ledger entries, per account (names from 371) and as a month-end trend', async () => {
    const entries = [
      { Bank_Account_No: 'WWB', Posting_Date: '2026-08-15', Amount_LCY: 1000 },
      { Bank_Account_No: 'WWB', Posting_Date: '2026-10-02', Amount_LCY: -300 },
      { Bank_Account_No: 'GIRO', Posting_Date: '2026-09-30', Amount_LCY: 50 },
    ]
    const accounts = [{ No: 'WWB', Name: 'World Wide Bank' }, { No: 'GIRO', Name: '' }]
    const f = fakeFetcher(url => ({ body: { value: url.includes('/BespoxAI_BankAccounts?') ? accounts : entries } }))
    const src = createFlowFilterSource(tenant, f)
    const total = await fetchMetric(src, 'cash_total', undefined, opts)
    assert.equal(total.scalar!.value, 750)
    const u = decodeURIComponent(f.urls[0])
    assert.ok(u.includes('/BespoxAI_BankLedgerEntries?') && u.includes('Posting_Date le 2026-10-13'), u)
    assert.ok(!u.includes('Bank_Account_Name'), 'page 372 has no Bank_Account_Name on BC14')
    assert.equal(f.urls.length, 1, 'cash total needs no names')
    const byAcc = await fetchMetric(src, 'cash_by_account', undefined, opts)
    assert.deepEqual(byAcc.breakdown!.rows.map(r => [r.label, r.value]), [['World Wide Bank', 700], ['GIRO', 50]])
    const before = f.urls.length
    const trend = await fetchMetric(src, 'cash_trend', undefined, opts)
    const pts = trend.series!.points
    assert.equal(pts.length, 12)
    assert.deepEqual(pts.slice(-3).map(p => p.value), [1000, 1050, 750])   // Aug, Sep, Oct month ends
    assert.equal(f.urls.length - before, 1, 'trend is one read, not one per month')
  })
  await test('AR/AP aging buckets and vendor sign flip', async () => {
    const entries = [
      { Due_Date: '2026-10-20', Remaining_Amt_LCY: 1000 },
      { Due_Date: '2026-10-01', Remaining_Amt_LCY: 500 },
      { Due_Date: '2026-05-01', Remaining_Amt_LCY: 200 },
    ]
    const ar = await fetchMetric(createFlowFilterSource(tenant, fakeFetcher(() => ({ body: { value: entries } }))), 'ar_aging', undefined, opts)
    assert.deepEqual(ar.breakdown!.rows.map(r => r.value), [1000, 500, 0, 0, 200])
    const ap = await fetchMetric(createFlowFilterSource(tenant, fakeFetcher(() => ({
      body: { value: entries.map(e => ({ ...e, Remaining_Amt_LCY: -e.Remaining_Amt_LCY })) },
    }))), 'ap_overdue', undefined, opts)
    assert.equal(ap.scalar!.value, 700)
    const apAll = await fetchMetric(createFlowFilterSource(tenant, fakeFetcher(() => ({
      body: { value: entries.map(e => ({ ...e, Remaining_Amt_LCY: -e.Remaining_Amt_LCY })) },
    }))), 'ap_outstanding', undefined, opts)
    assert.equal(apAll.scalar!.value, 1700)   // due and not yet due
  })
  await test('top customers sum ledger Sales (LCY) by posting date, ranked, top honoured', async () => {
    const rows = [
      { Customer_No: 'C1', Customer_Name: 'A', Sales_LCY: 10 }, { Customer_No: 'C2', Customer_Name: 'B', Sales_LCY: 30 },
      { Customer_No: 'C3', Customer_Name: '', Sales_LCY: 20 }, { Customer_No: 'C1', Customer_Name: 'A', Sales_LCY: 5 },
      { Customer_No: 'C4', Customer_Name: 'D', Sales_LCY: 0 },
    ]
    const f = fakeFetcher(() => ({ body: { value: rows } }))
    const r = await fetchMetric(createFlowFilterSource(tenant, f), 'top_customers', { period: 'ytd', top: 2 }, opts)
    assert.deepEqual(r.breakdown!.rows.map(x => x.label), ['B', 'C3'])
    const u = decodeURIComponent(f.urls[0])
    assert.ok(u.includes('/BespoxAI_CustLedgerEntries?') && u.includes('Posting_Date ge 2026-01-01 and Posting_Date le 2026-10-13'), u)
  })
  await test('top customers take names from the Customer List when ledger names are blank', async () => {
    const cle = [{ Customer_No: '30000', Customer_Name: '', Sales_LCY: 900 }, { Customer_No: '10000', Customer_Name: '', Sales_LCY: 300 }]
    const customers = [{ No: '30000', Name: 'John Haddock Insurance Co.' }, { No: '10000', Name: 'The Cannon Group PLC' }]
    const f = fakeFetcher(url => ({ body: { value: url.includes('/BespoxAI_Customers?') ? customers : cle } }))
    const r = await fetchMetric(createFlowFilterSource(tenant, f), 'top_customers', { period: 'ytd' }, opts)
    assert.deepEqual(r.breakdown!.rows.map(x => x.label), ['John Haddock Insurance Co.', 'The Cannon Group PLC'])
  })
  await test('fiscal calendar loads from Accounting Periods; falls back to calendar on 404', async () => {
    const f = fakeFetcher(() => ({ body: { value: [
      { Starting_Date: '2025-04-01', New_Fiscal_Year: true },
      { Starting_Date: '2026-04-01', New_Fiscal_Year: true },
    ] } }))
    const fc = await loadFiscalCalendar({ ...tenant, tenantId: 'fy1' }, { fetcher: f, buildUrl })
    assert.deepEqual(fc, { starts: ['2025-04-01', '2026-04-01'], source: 'nav' })
    assert.ok(decodeURIComponent(f.urls[0]).includes('/BespoxAI_AccountingPeriods?') && decodeURIComponent(f.urls[0]).includes('New_Fiscal_Year eq true'))
    await loadFiscalCalendar({ ...tenant, tenantId: 'fy1' }, { fetcher: f, buildUrl })
    assert.equal(f.urls.length, 1, 'second call should be cached')
    const missing = await loadFiscalCalendar({ ...tenant, tenantId: 'fy2' }, { fetcher: fakeFetcher(() => ({ status: 404 })), buildUrl })
    assert.deepEqual(missing, { starts: [], source: 'calendar' })
  })
  await test('YTD provenance says where the fiscal year came from', async () => {
    const f = fakeFetcher(() => ({ body: { value: [{ Customer_No: 'C1', Customer_Name: 'A', Sales_LCY: 5 }] } }))
    const r = await fetchMetric(createFlowFilterSource(tenant, f), 'top_customers', { period: 'ytd' },
      { today, fiscal: { starts: ['2026-04-01'], source: 'nav' } })
    assert.equal(r.provenance.fiscalYear, 'nav')
    assert.ok(decodeURIComponent(f.urls[0]).includes('Posting_Date ge 2026-04-01'))
    const m = await fetchMetric(createFlowFilterSource(tenant, f), 'pl_revenue', { period: 'this_month' }, opts).catch(() => null)
    assert.ok(!m || m.provenance.fiscalYear === undefined)
  })

  console.log('Editor')
  await test('edits keep the default pack valid and never mutate it', () => {
    const before = JSON.stringify(DEFAULT_CFO_PACK)
    let s = addWidget(DEFAULT_CFO_PACK, 'pl', 'pl_revenue')            // duplicate metric → fresh id
    s = updateWidget(s, 'pl-rev', { title: 'Revenue', params: { period: 'ytd' }, width: 6 })
    s = moveWidget(s, 'pl-rev', 1)
    s = moveWidget(s, 'pl-rev', -1)
    s = removeWidget(s, 'cash-acc')
    s = addSection(s, 'Watch list')
    s = addWidget(s, 'watch-list', 'top_customers')
    s = renameSection(s, 'sales', 'Sales & customers')
    s = removeSection(s, 'arap')
    s = addSection(s, 'Empty one')
    s = tidy(s)
    assert.equal(JSON.stringify(DEFAULT_CFO_PACK), before)
    const r = validateSpec(s)
    assert.ok(r.ok, JSON.stringify(r))
    const ids = s.sections.flatMap(x => x.widgets.map(w => w.id))
    assert.equal(new Set(ids).size, ids.length)
    const rev = s.sections[0].widgets.find(w => w.id === 'pl-rev')!
    assert.deepEqual(rev.params, { period: 'ytd', compare: 'prior_period' })  // patch merges params
    assert.equal(s.sections[0].widgets[0].id, 'pl-rev')                    // moved back to the top
    assert.ok(!s.sections.some(x => x.title === 'Empty one'))
  })
  await test('every metric gets a widget the validator accepts', () => {
    let s: any = { version: 1, name: 'All', sections: [{ id: 'all', title: 'All', widgets: [] }] }
    for (const id of Object.keys(METRICS)) s = addWidget(s, 'all', id)
    const r = validateSpec(s)
    assert.ok(r.ok, JSON.stringify(r))
  })

  console.log('AI edits')
  await test('prompt lists every metric and no figures', () => {
    const p = buildSystemPrompt()
    for (const id of Object.keys(METRICS)) assert.ok(p.includes(id), id)
    const layout = describeLayout(DEFAULT_CFO_PACK)
    assert.ok(layout.includes('id=pl-rev') && !/\$\d/.test(layout))
  })
  await test('applies valid ops, including a new section, in a fenced reply', () => {
    const reply = '```json\n' + JSON.stringify({
      reply: 'Added quarterly revenue and moved top customers to last quarter.',
      ops: [
        { op: 'add_widget', section: 'Quarterly', metricId: 'pl_revenue', title: 'Revenue this quarter', type: 'kpi', width: 6, params: { period: 'this_quarter', compare: 'prior_year' } },
        { op: 'update_widget', widgetId: 'top-cust', params: { period: 'last_quarter', top: 5 } },
        { op: 'remove_widget', widgetId: 'cash-acc' },
      ],
      unsupported: null,
    }) + '\n```'
    const r = applyAiReply(DEFAULT_CFO_PACK, reply)
    assert.ok(r.ok); assert.equal(r.applied, 3); assert.deepEqual(r.rejected, [])
    const q = r.spec.sections.find(s => s.title === 'Quarterly')!
    assert.deepEqual(q.widgets[0].params, { period: 'this_quarter', compare: 'prior_year' })
    const top = r.spec.sections.flatMap(s => s.widgets).find(w => w.id === 'top-cust')!
    assert.deepEqual(top.params, { period: 'last_quarter', top: 5 })
    assert.ok(!r.spec.sections.flatMap(s => s.widgets).some(w => w.id === 'cash-acc'))
  })
  await test('drops invented metrics, bad params, bad types and missing widgets', () => {
    const reply = JSON.stringify({ reply: 'x', unsupported: 'No region breakdown', ops: [
      { op: 'add_widget', section: 'pl', metricId: 'gross_margin_by_region' },
      { op: 'add_widget', section: 'pl', metricId: 'pl_revenue', type: 'line' },           // kpi-only metric → type ignored, still added
      { op: 'update_widget', widgetId: 'cash-total', params: { period: 'ytd' } },          // cash_total takes no period → nothing left to change
      { op: 'remove_widget', widgetId: 'nope' },
      { op: 'drop_table' },
    ] })
    const r = applyAiReply(DEFAULT_CFO_PACK, reply)
    assert.ok(r.ok)
    assert.equal(r.applied, 1)
    assert.equal(r.rejected.length, 4, r.rejected.join(' | '))
    assert.equal(r.unsupported, 'No region breakdown')
    const added = r.spec.sections[0].widgets.slice(-1)[0]
    assert.equal(added.type, 'kpi')
  })
  await test('garbage reply changes nothing', () => {
    const r = applyAiReply(DEFAULT_CFO_PACK, 'I am not JSON')
    assert.equal(r.ok, false); assert.equal(r.spec, DEFAULT_CFO_PACK)
  })

  console.log('Installer')
  await test('installer publishes exactly the BC_SERVICES pages', () => {
    const ps1 = readFileSync(join(__dirname, 'Install-BespoxAI.ps1'), 'utf8')
    const block = ps1.split('$DashboardServices = @(')[1]?.split(')\n')[0] ?? ''
    const found = Array.from(block.matchAll(/Name = '([A-Za-z_]+)';\s*PageId = (\d+)/g)).map(m => m[1] + ':' + m[2]).sort()
    const expected = Object.values(BC_SERVICES).map(s => s.serviceName + ':' + s.pageId).sort()
    assert.deepEqual(found, expected)
  })
  await test('agent version matches in all four places', () => {
    const ps1 = readFileSync(join(__dirname, 'Install-BespoxAI.ps1'), 'utf8')
    const v = [
      ps1.match(/^\$AgentVersion\s*=\s*'([\d.]+)'/m)?.[1],
      ps1.match(/^\$Version\s*=\s*'([\d.]+)'/m)?.[1],
      readFileSync(join(__dirname, '../app/api/settings/installer/route.ts'), 'utf8').match(/AGENT_VERSION = '([\d.]+)'/)?.[1],
      readFileSync(join(__dirname, '../app/api/partner/tenants/[id]/installer/route.ts'), 'utf8').match(/AGENT_VERSION = '([\d.]+)'/)?.[1],
    ]
    assert.ok(v[0], 'version not found')
    assert.deepEqual(v, [v[0], v[0], v[0], v[0]])
  })
  await test('executor rejects invalid params', async () => {
    await assert.rejects(fetchMetric(mockSource, 'cash_total', { period: 'ytd' }, opts))
    await assert.rejects(fetchMetric(mockSource, 'nope', undefined, opts))
  })

  console.log('\n' + passed + ' passed')
}

main().catch(e => { console.error(e?.message ?? e); process.exit(1) })
