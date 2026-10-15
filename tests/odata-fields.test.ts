/**
 * tests/odata-fields.test.ts
 *
 * The planner's OData fields are checked against the page's real fields before
 * calling BC, so an invented field doesn't turn a good question into a recorded
 * "bad query".
 *
 * Run: npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkPlanFields, filterFields, ensureSelected } from '../lib/odata-fields'

const INV = ['No', 'Sell_to_Customer_No', 'Sell_to_Customer_Name', 'Posting_Date', 'Due_Date', 'Currency_Code']

test('filter fields: keywords, functions, quoted strings and date literals ignored', () => {
  assert.deepEqual(filterFields("Open eq true and Due_Date lt 2026-10-16 and contains(Name,'and Customer_No eq x')"), ['Open', 'Due_Date', 'Name'])
  assert.deepEqual(filterFields('Posting_Date ge 2024-01-01T00:00:00Z and Amount ge 10000'), ['Posting_Date', 'Amount'])
  assert.deepEqual(filterFields("Name eq 'O''Brien'"), ['Name'])
})

test('unknown $select / $orderby fields are dropped; the query still runs', () => {
  const r = checkPlanFields('$top=3&$select=No,Customer_No,Posting_Date&$orderby=Posting_Date desc,Invoice_Date desc', INV)
  assert.equal(r.params, '$top=3&$select=No,Posting_Date&$orderby=Posting_Date desc')
  assert.deepEqual(r.dropped, ['Customer_No', 'Invoice_Date'])
  assert.deepEqual(r.unknownInFilter, [])
})

test('an invented filter field is reported, not sent', () => {
  const r = checkPlanFields("$top=3&$filter=Customer_No eq '30000'&$orderby=Posting_Date desc", INV)
  assert.deepEqual(r.unknownInFilter, ['Customer_No'])
  assert.deepEqual(checkPlanFields("$filter=Sell_to_Customer_No eq '30000'", INV).unknownInFilter, [])
})

test('without metadata nothing is changed', () => {
  assert.equal(checkPlanFields('$select=Anything', null).params, '$select=Anything')
  assert.equal(checkPlanFields('$select=Anything', []).params, '$select=Anything')
})

test('ensureSelected adds needed fields the page has, only to an existing $select', () => {
  assert.equal(ensureSelected('$top=5&$select=No', ['Sell_to_Customer_Name', 'Nope'], INV), '$top=5&$select=No,Sell_to_Customer_Name')
  assert.equal(ensureSelected('$top=5', ['Sell_to_Customer_Name'], INV), '$top=5')
})
