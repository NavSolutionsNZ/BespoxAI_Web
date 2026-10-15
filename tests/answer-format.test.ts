/**
 * tests/answer-format.test.ts
 *
 * CFO Assistant answer shaping: parsing the answerer's reply (JSON, fenced,
 * wrapped in prose, or prose only) and keeping identifier columns such as
 * Invoice No and Entry No free of thousands separators.
 *
 * Run: npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAnswerPayload, isIdentifierHeader } from '../lib/answer-format'

test('plain JSON parses', () => {
  const p = parseAnswerPayload('{"answer":"Total AR is $5.00","displayHint":"kpi","data":{"kpis":[]}}')
  assert.equal(p.answer, 'Total AR is $5.00')
  assert.equal(p.displayHint, 'kpi')
  assert.deepEqual(p.data, { kpis: [] })
})

test('fenced JSON parses', () => {
  const p = parseAnswerPayload('```json\n{"answer":"A","displayHint":"table","data":null}\n```')
  assert.equal(p.answer, 'A')
  assert.equal(p.displayHint, 'table')
})

test('JSON wrapped in a sentence is extracted', () => {
  const p = parseAnswerPayload('Here is the result:\n{"answer":"Top item is X","displayHint":"bar_chart","data":{"columns":["Item","Qty"],"rows":[["X",3]]}}\nHope that helps.')
  assert.equal(p.answer, 'Top item is X')
  assert.equal(p.displayHint, 'bar_chart')
})

test('prose with no JSON becomes a narrative answer, not an error', () => {
  const p = parseAnswerPayload('The top items sold in 2022 were the ATHENS Desk and the PARIS Guest Chair.')
  assert.equal(p.displayHint, 'narrative')
  assert.equal(p.data, null)
  assert.match(p.answer, /^The top items sold/)
})

test('missing fields get defaults; an empty reply throws', () => {
  const p = parseAnswerPayload('{"data":null}')
  assert.equal(p.answer, 'No answer generated.')
  assert.equal(p.displayHint, 'narrative')
  assert.throws(() => parseAnswerPayload('  '))
})

test('identifier headers are recognised', () => {
  for (const h of ['Invoice No', 'Entry No', 'Document No.', 'No', 'No.', 'Account Number', 'Item Code', 'Customer ID', 'Vendor_No'])
    assert.ok(isIdentifierHeader(h), h)
})

test('quantities and amounts are not identifiers', () => {
  for (const h of ['Amount ($)', 'Balance ($)', 'Quantity', 'No. of invoices', 'Number of orders', 'Posting Date', 'Notes', 'Nominal', 'Customer'])
    assert.ok(!isIdentifierHeader(h), h)
})

test('ISO dates in table cells read as "26 Jan 2023"', async () => {
  const { formatIsoDate } = await import('../lib/answer-format')
  assert.equal(formatIsoDate('2023-01-26'), '26 Jan 2023')
  assert.equal(formatIsoDate('2023-01-05T00:00:00Z'), '5 Jan 2023')
  assert.equal(formatIsoDate('2023-13-01'), null)
  assert.equal(formatIsoDate('103027'), null)
  assert.equal(formatIsoDate('2023-01-26T14:30:00Z'), null)   // a real time — leave as is
})
