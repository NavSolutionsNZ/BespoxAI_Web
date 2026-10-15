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
