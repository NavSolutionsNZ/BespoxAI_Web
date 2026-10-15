/**
 * tests/query-aggregate.test.ts
 *
 * The CFO Assistant computes totals in code (lib/query-aggregate.ts) instead of
 * letting the answerer model add records up — chat said overdue debtors were
 * $2,782,442.01 when the exact figure was $3,204,400.99.
 *
 * Run: npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeAggSpec, aggregateRecords, describeAggregate, aggregateDisplayData, formatMeasure } from '../lib/query-aggregate'

const cle = [
  { Customer_No: '30000', Customer_Name: 'John Haddock Insurance Co.', Remaining_Amt_LCY: 1000.10 },
  { Customer_No: '30000', Customer_Name: 'John Haddock Insurance Co.', Remaining_Amt_LCY: 209.45 },
  { Customer_No: '10000', Customer_Name: 'The Cannon Group PLC', Remaining_Amt_LCY: 582.84 },
  { Customer_No: '20000', Customer_Name: '', Remaining_Amt_LCY: -50 },
  { Customer_No: '40000', Customer_Name: 'Deerfield Graphics', Remaining_Amt_LCY: '75.5' },
]

test('sanitize: keeps a valid spec, drops junk', () => {
  const s = sanitizeAggSpec({ groupBy: 'Customer_No', labelField: 'Customer_Name', measures: [{ field: 'Remaining_Amt_LCY', op: 'sum', label: 'Overdue ($)' }, { op: 'drop table' }, { field: 'x;y', op: 'sum' }], top: 500 })!
  assert.equal(s.measures.length, 1)
  assert.equal(s.top, 100)
  assert.equal(s.sort, 'desc')
  assert.equal(sanitizeAggSpec(null), null)
  assert.equal(sanitizeAggSpec({ measures: [] }), null)
  assert.equal(sanitizeAggSpec({ groupBy: "a') or 1=1", measures: [{ op: 'count' }] })!.groupBy, null)
})

test('exact total over every record, grouped, named and ranked', () => {
  const a = aggregateRecords(cle, sanitizeAggSpec({ groupBy: 'Customer_No', labelField: 'Customer_Name', measures: [{ field: 'Remaining_Amt_LCY', op: 'sum', label: 'Overdue ($)' }] })!)
  assert.equal(a.totals[0], 1817.89)                     // 1000.10 + 209.45 + 582.84 - 50 + 75.5
  assert.equal(a.recordCount, 5)
  assert.deepEqual(a.groups.map(g => [g.label, g.values[0]]), [
    ['John Haddock Insurance Co.', 1209.55], ['The Cannon Group PLC', 582.84], ['Deerfield Graphics', 75.5], ['20000', -50],
  ])
  assert.equal(a.groupLabel, 'Customer Name')
})

test('top keeps the ranking but the totals stay complete', () => {
  const a = aggregateRecords(cle, sanitizeAggSpec({ groupBy: 'Customer_No', measures: [{ field: 'Remaining_Amt_LCY', op: 'sum', label: 'Overdue' }], top: 2 })!)
  assert.equal(a.groups.length, 2)
  assert.equal(a.groupCount, 4)
  assert.equal(a.totals[0], 1817.89)
})

test('count, avg, min, max and negate', () => {
  const ve = [{ Remaining_Amt_LCY: -100 }, { Remaining_Amt_LCY: -300 }, { Remaining_Amt_LCY: null }]
  const a = aggregateRecords(ve, sanitizeAggSpec({ measures: [
    { field: 'Remaining_Amt_LCY', op: 'sum', label: 'Owed', negate: true },
    { op: 'count', label: 'Entries' },
    { field: 'Remaining_Amt_LCY', op: 'avg', label: 'Avg', negate: true },
    { field: 'Remaining_Amt_LCY', op: 'max', label: 'Largest', negate: true },
  ] })!)
  assert.deepEqual(a.totals, [400, 3, 200, 300])
})

test('period grouping by month reads oldest to newest', () => {
  const inv = [
    { Posting_Date: '2023-01-26', Amount: 100 }, { Posting_Date: '2022-12-02', Amount: 40 },
    { Posting_Date: '2023-01-03', Amount: 10 }, { Posting_Date: '0001-01-01', Amount: 999 },
  ]
  const a = aggregateRecords(inv, sanitizeAggSpec({ groupBy: 'Posting_Date', period: 'month', measures: [{ field: 'Amount', op: 'sum', label: 'Revenue ($)' }] })!)
  assert.deepEqual(a.groups.map(g => [g.label, g.values[0]]), [['Dec 2022', 40], ['Jan 2023', 110]])
  const q = aggregateRecords(inv, sanitizeAggSpec({ groupBy: 'Posting_Date', period: 'quarter', measures: [{ field: 'Amount', op: 'sum', label: 'R' }] })!)
  assert.deepEqual(q.groups.map(g => g.label), ['Q4 2022', 'Q1 2023'])
})

test('the answerer gets the exact figures, and display data is built from them', () => {
  const a = aggregateRecords(cle, sanitizeAggSpec({ groupBy: 'Customer_No', labelField: 'Customer_Name', measures: [{ field: 'Remaining_Amt_LCY', op: 'sum', label: 'Overdue ($)' }] })!)
  const text = describeAggregate(a, false)
  assert.match(text, /all 5 matching records/)
  assert.match(text, /Overdue \(\$\) = \$1,817\.89/)
  assert.match(text, /John Haddock Insurance Co\. \[30000\]: Overdue \(\$\) \$1,209\.55/)
  assert.match(describeAggregate(a, true), /may be incomplete/)
  const bar = aggregateDisplayData(a, 'bar_chart')
  assert.deepEqual(bar.columns, ['Customer Name', 'Overdue ($)'])
  assert.deepEqual(bar.rows[0], ['John Haddock Insurance Co.', 1209.55])
  const kpi = aggregateDisplayData(a, 'kpi')
  assert.equal(kpi.kpis[0].value, '$1,817.89')
  assert.equal(aggregateDisplayData(a, 'narrative'), null)
})

test('money vs plain numbers', () => {
  assert.equal(formatMeasure({ field: 'Amount_LCY', op: 'sum', label: '' }, -4861525.5), '-$4,861,525.50')
  assert.equal(formatMeasure({ op: 'count', label: '' }, 1234), '1,234')
})

test('grouping by a No. field shows the Name field when records carry it', async () => {
  const { withGroupNames } = await import('../lib/query-aggregate')
  // Inferred from the records, even without labelField
  const a = aggregateRecords(cle, sanitizeAggSpec({ groupBy: 'Customer_No', measures: [{ field: 'Remaining_Amt_LCY', op: 'sum', label: 'Overdue' }] })!)
  assert.equal(a.groups[0].label, 'John Haddock Insurance Co.')
  assert.equal(a.groupLabel, 'Customer Name')
  // Before fetching: the Name is added to $select when the entity has it
  const spec = sanitizeAggSpec({ groupBy: 'Customer_No', measures: [{ field: 'Remaining_Amt_LCY', op: 'sum', label: 'Overdue' }] })!
  const w = withGroupNames('$top=50&$select=Customer_No,Remaining_Amt_LCY&$filter=Open eq true', spec, ['Customer_No', 'Customer_Name', 'Remaining_Amt_LCY'])
  assert.equal(w.params, '$top=50&$select=Customer_No,Remaining_Amt_LCY,Customer_Name&$filter=Open eq true')
  assert.equal(w.spec.labelField, 'Customer_Name')
  // Entity without a Name field (bank ledger): unchanged
  const b = sanitizeAggSpec({ groupBy: 'Bank_Account_No', measures: [{ field: 'Amount_LCY', op: 'sum', label: 'Balance' }] })!
  const wb = withGroupNames('$select=Bank_Account_No,Amount_LCY', b, ['Bank_Account_No', 'Amount_LCY'])
  assert.equal(wb.params, '$select=Bank_Account_No,Amount_LCY')
  assert.equal(wb.spec.labelField, null)
})

test('a labelField that repeats the group field falls back to the Name field', async () => {
  const { withGroupNames } = await import('../lib/query-aggregate')
  const spec = sanitizeAggSpec({ groupBy: 'Customer_No', labelField: 'Customer_No', measures: [{ field: 'Remaining_Amt_LCY', op: 'sum', label: 'Overdue' }] })!
  const w = withGroupNames('$select=Customer_No,Remaining_Amt_LCY', spec, ['Customer_No', 'Customer_Name', 'Remaining_Amt_LCY'])
  assert.equal(w.spec.labelField, 'Customer_Name')
  assert.match(w.params, /Customer_Name/)
  const bad = sanitizeAggSpec({ groupBy: 'Bank_Account_No', labelField: 'Bank_Name', measures: [{ field: 'Amount_LCY', op: 'sum', label: 'B' }] })!
  assert.equal(withGroupNames('$select=Bank_Account_No,Amount_LCY', bad, ['Bank_Account_No', 'Amount_LCY']).spec.labelField, null)
})

test('blank ledger names are filled from the master record', async () => {
  const { unnamedGroupKeys, applyGroupNames, noFilter, NAME_SOURCES } = await import('../lib/query-aggregate')
  const recs = [{ Customer_No: '30000', Customer_Name: '', Amt: 5 }, { Customer_No: '01454545', Customer_Name: '', Amt: 3 }, { Customer_No: "O'B", Customer_Name: 'Named', Amt: 1 }]
  const a = aggregateRecords(recs, sanitizeAggSpec({ groupBy: 'Customer_No', labelField: 'Customer_Name', measures: [{ field: 'Amt', op: 'sum', label: 'Overdue' }] })!)
  assert.deepEqual(unnamedGroupKeys(a), ['30000', '01454545'])
  assert.equal(noFilter(["30000", "O'B"]), "No eq '30000' or No eq 'O''B'")
  applyGroupNames(a, new Map([['30000', 'John Haddock Insurance Co.'], ['01454545', 'New Concepts Furniture']]), 'Customer')
  assert.deepEqual(a.groups.map(g => g.label), ['John Haddock Insurance Co.', 'New Concepts Furniture', 'Named'])
  assert.equal(a.groupLabel, 'Customer')
  assert.equal(NAME_SOURCES.Vendor_No.logical, 'Vendor')
})

test('groups that share a name get their No. added', async () => {
  const { disambiguateLabels } = await import('../lib/query-aggregate')
  const recs = [
    { Bank_Account_No: 'WWB-OPERATING', Name: 'World Wide Bank', Amt: -10 }, { Bank_Account_No: 'WWB-EUR', Name: 'World Wide Bank', Amt: 5 },
    { Bank_Account_No: 'NBA', Name: 'New Bank of Auckland', Amt: 2 },
  ]
  const a = aggregateRecords(recs, sanitizeAggSpec({ groupBy: 'Bank_Account_No', labelField: 'Name', measures: [{ field: 'Amt', op: 'sum', label: 'Balance' }], sort: 'asc' })!)
  disambiguateLabels(a)
  assert.deepEqual(a.groups.map(g => g.label), ['World Wide Bank (WWB-OPERATING)', 'New Bank of Auckland', 'World Wide Bank (WWB-EUR)'])
})

// ─── Defaults when the planner gives no aggregate (16 Oct 2026) ─────────────
import { defaultLedgerAggregate, listSummarySpec, missingNameLookups, fillRecordNames, recordsTable, aggregateRecords as aggAll } from '../lib/query-aggregate'

const overdueParams = '$filter=Open eq true and Due_Date lt 2026-10-16&$select=Entry_No,Customer_No,Customer_Name,Due_Date,Remaining_Amt_LCY'

test('overdue debtors with no aggregate → exact per-customer totals', () => {
  const spec = defaultLedgerAggregate('CustLedgerEntry', overdueParams, 'Show me overdue debtors')
  assert.ok(spec)
  assert.equal(spec!.groupBy, 'Customer_No')
  assert.equal(spec!.measures[0].field, 'Remaining_Amt_LCY')
  assert.equal(spec!.measures[0].label, 'Overdue ($)')
  // All entries counted — not the six the model picked.
  const recs = [
    { Customer_No: '01454545', Remaining_Amt_LCY: 765476.74 },
    { Customer_No: '30000', Remaining_Amt_LCY: 262348.34 },
    { Customer_No: '30000', Remaining_Amt_LCY: 116599.26 },
    { Customer_No: '10000', Remaining_Amt_LCY: 100 },
  ]
  const a = aggAll(recs, spec!)
  assert.equal(a.totals[0], 1144524.34)
  assert.deepEqual(a.groups.map(g => g.key), ['01454545', '30000', '10000'])
  assert.equal(a.groups[1].values[1], 2)   // entry count per customer
})

test('vendor totals are negated; bank uses Amount_LCY', () => {
  const v = defaultLedgerAggregate('VendorLedgerEntry', '$filter=Open eq true&$select=Vendor_No,Remaining_Amt_LCY', 'outstanding payables')
  assert.equal(v!.measures[0].negate, true)
  assert.equal(v!.measures[0].label, 'Outstanding ($)')
  const b = defaultLedgerAggregate('BankAccountLedgerEntry', '$select=Entry_No,Bank_Account_No,Amount_LCY', 'bank balances')
  assert.equal(b!.measures[0].field, 'Amount_LCY')
  assert.equal(b!.measures[0].negate, false)
})

test('drill-down: entries asked for, or one customer named → no default', () => {
  assert.equal(defaultLedgerAggregate('CustLedgerEntry', overdueParams, 'Show the overdue entries for customer 30000'), null)
  assert.equal(defaultLedgerAggregate('CustLedgerEntry', overdueParams, 'List the invoices that are overdue'), null)
  assert.equal(defaultLedgerAggregate('CustLedgerEntry', "$filter=Customer_No eq '30000' and Open eq true", 'what does 30000 owe'), null)
  assert.equal(defaultLedgerAggregate('Customer', '$select=No,Name,Balance_LCY', 'overdue debtors'), null)
})

test('plain list: exact count and money sums, identifiers not summed', () => {
  const spec = listSummarySpec(['No', 'Posting_Date', 'Customer_No', 'Amount_LCY', 'Remaining_Amt_LCY'])
  assert.deepEqual(spec.measures.map(m => m.field ?? m.op), ['count', 'Amount_LCY', 'Remaining_Amt_LCY'])
})

test('blank ledger names are found and filled from the master record', () => {
  const recs: any[] = [
    { Customer_No: '30000', Customer_Name: '', Amount: 1 },
    { Customer_No: '30000', Customer_Name: '', Amount: 2 },
    { Customer_No: '20000', Customer_Name: 'Already named', Amount: 3 },
  ]
  const looks = missingNameLookups(recs)
  assert.equal(looks.length, 1)
  assert.deepEqual(looks[0].keys, ['30000'])
  fillRecordNames(recs, 'Customer_No', 'Customer_Name', new Map([['30000', 'John Haddock Insurance Co.'], ['20000', 'Wrong']]))
  assert.equal(recs[0].Customer_Name, 'John Haddock Insurance Co.')
  assert.equal(recs[2].Customer_Name, 'Already named')
})

test('records table uses real rows and puts the name beside the No.', () => {
  const recs = [
    { '@odata.etag': 'x', Entry_No: 1, Customer_No: '30000', Customer_Name: 'Haddock', Due_Date: '2023-01-31', Remaining_Amt_LCY: 262348.34, Open: true },
  ]
  const t = recordsTable(recs, ['Entry_No', 'Customer_No', 'Due_Date', 'Remaining_Amt_LCY', 'Open'])!
  assert.deepEqual(t.columns, ['Customer No.', 'Customer Name', 'Due Date', 'Remaining Amt LCY', 'Open'])
  assert.deepEqual(t.rows[0], ['30000', 'Haddock', '2023-01-31', 262348.34, 'Yes'])
})
