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
import { createFlowFilterSource as createFF, type JsonFetcher } from '../lib/dashboards/sources/flowfilter'
import { MetricSourceError } from '../lib/dashboards/types'
import { optKey } from '../lib/dashboards/bc-services'
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
  await test('fiscal year start month moves YTD', () => {
    assert.equal(resolvePeriod('ytd', today, 1).from, '2026-01-01')
    assert.equal(resolvePeriod('ytd', today, 4).from, '2026-04-01')
    assert.equal(resolvePeriod('ytd', new Date(2026, 1, 1), 4).from, '2025-04-01')
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
    assert.ok(u.includes('Date_Filter ge 2026-10-01 and Date_Filter le 2026-10-31'), u)
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
  await test('follows nextLink on the tunnel host only', async () => {
    const next = tenant.agentBaseUrl + '/NAV/ODataV4/Company(\'CRONUS\')/BespoxAI_BankAccounts?$skiptoken=2'
    const f = fakeFetcher(url => url.includes('skiptoken')
      ? { body: { value: [{ Name: 'B', Balance_at_Date_LCY: 50 }], '@odata.nextLink': 'https://evil.example.com/x' } }
      : { body: { value: [{ Name: 'A', Balance_at_Date_LCY: 100 }], '@odata.nextLink': next } })
    const r = await fetchMetric(createFlowFilterSource(tenant, f), 'cash_total', undefined, opts)
    assert.equal(r.scalar!.value, 150)
    assert.equal(f.urls.length, 2)
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
  })
  await test('top customers ranked, zero-sales dropped, top honoured', async () => {
    const rows = [{ No: 'C1', Name: 'A', Sales_LCY: 10 }, { No: 'C2', Name: 'B', Sales_LCY: 30 }, { No: 'C3', Name: '', Sales_LCY: 20 }, { No: 'C4', Name: 'D', Sales_LCY: 0 }]
    const r = await fetchMetric(createFlowFilterSource(tenant, fakeFetcher(() => ({ body: { value: rows } }))), 'top_customers', { period: 'ytd', top: 2 }, opts)
    assert.deepEqual(r.breakdown!.rows.map(x => x.label), ['B', 'C3'])
  })
  await test('executor rejects invalid params', async () => {
    await assert.rejects(fetchMetric(mockSource, 'cash_total', { period: 'ytd' }, opts))
    await assert.rejects(fetchMetric(mockSource, 'nope', undefined, opts))
  })

  console.log('\n' + passed + ' passed')
}

main().catch(e => { console.error(e?.message ?? e); process.exit(1) })
