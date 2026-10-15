/**
 * tests/bc-entities.test.ts
 *
 * CFO Assistant entity catalogue: $metadata parsing, resolving logical entities
 * to the OData names a tenant actually publishes (BespoxAI_ services from the
 * 3.13 installer, or the standard names), field narrowing, and that the
 * installer publishes exactly CFO_SERVICES.
 *
 * Run: npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseMetadata, resolveEntities, buildCatalogue, catalogueSummary, CFO_SERVICES } from '../lib/bc-entities'

const META = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="NAV" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityType Name="BespoxAI_Customer">
        <Key><PropertyRef Name="No" /></Key>
        <Property Name="No" Type="Edm.String" Nullable="false" />
        <Property Name="Name" Type="Edm.String" />
        <Property Name="Balance_LCY" Type="Edm.Decimal" />
        <NavigationProperty Name="Sales_Hist" Type="NAV.Whatever" />
      </EntityType>
      <EntityType Name="BespoxAI_SalesInvoice">
        <Property Name="No" Type="Edm.String" />
        <Property Name="Posting_Date" Type="Edm.Date" />
        <Property Name="Sell_to_Customer_Name" Type="Edm.String" />
      </EntityType>
      <EntityType Name="BespoxAI_SalesInvoiceSalesInvLines">
        <Property Name="Document_No" Type="Edm.String" />
        <Property Name="Line_Amount" Type="Edm.Decimal" />
      </EntityType>
      <EntityType Name="Vendor">
        <Property Name="No" Type="Edm.String" />
        <Property Name="Name" Type="Edm.String" />
      </EntityType>
      <EntityType Name="SalesOrder">
        <Property Name="No" Type="Edm.String" />
      </EntityType>
      <EntityType Name="SalesOrderSalesLines">
        <Property Name="Document_No" Type="Edm.String" />
      </EntityType>
      <EntityType Name="BespoxAI_GLAccounts">
        <Property Name="No" Type="Edm.String" />
      </EntityType>
      <EntityContainer Name="NAV">
        <EntitySet Name="BespoxAI_Customer" EntityType="NAV.BespoxAI_Customer" />
        <EntitySet Name="BespoxAI_SalesInvoice" EntityType="NAV.BespoxAI_SalesInvoice" />
        <EntitySet Name="BespoxAI_SalesInvoiceSalesInvLines" EntityType="NAV.BespoxAI_SalesInvoiceSalesInvLines" />
        <EntitySet Name="Customer" EntityType="NAV.Vendor" />
        <EntitySet Name="Vendor" EntityType="NAV.Vendor" />
        <EntitySet Name="SalesOrder" EntityType="NAV.SalesOrder" />
        <EntitySet Name="SalesOrderSalesLines" EntityType="NAV.SalesOrderSalesLines" />
        <EntitySet Name="BespoxAI_GLAccounts" EntityType="NAV.BespoxAI_GLAccounts" />
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`

test('parseMetadata reads entity sets and their properties (not navigation properties)', () => {
  const m = parseMetadata(META)
  assert.ok(m.entitySets.includes('BespoxAI_Customer'))
  assert.equal(m.entitySets.length, 8)
  assert.deepEqual(m.fields['BespoxAI_Customer'], ['No', 'Name', 'Balance_LCY'])
  assert.deepEqual(m.fields['Customer'], ['No', 'Name'])   // set name ≠ type name
})

test('resolveEntities prefers BespoxAI_ services, falls back to standard names', () => {
  const r = resolveEntities(parseMetadata(META).entitySets)
  assert.equal(r.Customer, 'BespoxAI_Customer')       // both exist → ours
  assert.equal(r.Vendor, 'Vendor')                     // only the standard one
  assert.equal(r.SalesOrder, 'SalesOrder')
  assert.equal(r.SalesOrderSalesLines, 'SalesOrderSalesLines')
  assert.equal(r.SalesInvoice, 'BespoxAI_SalesInvoice')
  // Posted invoice lines aren't called SalesLines → the one other set under the header
  assert.equal(r.SalesInvoiceSalesLines, 'BespoxAI_SalesInvoiceSalesInvLines')
  assert.equal(r.Item, undefined)                      // not published at all
  assert.equal(r.GeneralLedgerEntry, undefined)
})

test('a line entity is not guessed when the header has several candidates', () => {
  const r = resolveEntities(['BespoxAI_SalesInvoice', 'BespoxAI_SalesInvoiceA', 'BespoxAI_SalesInvoiceB'])
  assert.equal(r.SalesInvoice, 'BespoxAI_SalesInvoice')
  assert.equal(r.SalesInvoiceSalesLines, undefined)
})

test('buildCatalogue offers only published entities, with fields that exist', () => {
  const cat = buildCatalogue(parseMetadata(META), null)
  const names = cat.map(c => c.logical).sort()
  assert.deepEqual(names, ['Customer', 'SalesInvoice', 'SalesInvoiceSalesLines', 'SalesOrder', 'SalesOrderSalesLines', 'Vendor'])
  const customer = cat.find(c => c.logical === 'Customer')!
  assert.equal(customer.entitySet, 'BespoxAI_Customer')
  assert.deepEqual(customer.fields, ['No', 'Name', 'Balance_LCY'])   // hints narrowed to real properties
  const lines = cat.find(c => c.logical === 'SalesInvoiceSalesLines')!
  assert.deepEqual(lines.fields, ['Document_No', 'Line_Amount'])
})

test('buildCatalogue: when hints match nothing, the page\'s own fields are offered', () => {
  const cat = buildCatalogue(parseMetadata(META), null)
  const order = cat.find(c => c.logical === 'SalesOrder')!
  assert.deepEqual(order.fields, ['No'])
})

test('buildCatalogue respects entities switched off, by OData or logical name', () => {
  const meta = parseMetadata(META)
  assert.ok(!buildCatalogue(meta, { BespoxAI_Customer: false }).some(c => c.logical === 'Customer'))
  assert.ok(!buildCatalogue(meta, { Vendor: false }).some(c => c.logical === 'Vendor'))
  assert.ok(buildCatalogue(meta, { Vendor: true }).some(c => c.logical === 'Vendor'))
})

test('without metadata the static catalogue is used under standard names', () => {
  const cat = buildCatalogue(null, { Item: false })
  assert.ok(cat.length > 10)
  assert.ok(cat.every(c => c.entitySet === c.logical))
  assert.ok(!cat.some(c => c.logical === 'Item'))
})

test('catalogueSummary lists logical names and fields for the planner', () => {
  const text = catalogueSummary(buildCatalogue(parseMetadata(META), null))
  assert.match(text, /- Customer: .*\n    Fields: No, Name, Balance_LCY/)
  assert.doesNotMatch(text, /BespoxAI_/)
})

test('installer publishes exactly CFO_SERVICES', () => {
  const ps1 = readFileSync(join(__dirname, '..', 'scripts', 'Install-BespoxAI.ps1'), 'utf8')
  const block = ps1.split('$CfoServices = @(')[1]?.split(')\n')[0] ?? ''
  const found = Array.from(block.matchAll(/Name = '([A-Za-z_]+)';\s*PageId = (\d+)/g)).map(m => m[1] + ':' + m[2]).sort()
  const expected = CFO_SERVICES.map(s => s.serviceName + ':' + s.pageId).sort()
  assert.ok(found.length > 0, 'CfoServices block not found in the installer')
  assert.deepEqual(found, expected)
})

test('ledger and bank entities resolve to the dashboard services, then BC standard names', () => {
  const r = resolveEntities(['BespoxAI_CustLedgerEntries', 'Cust_LedgerEntries', 'VendorLedgerEntries', 'BespoxAI_BankLedgerEntries', 'BankAccountLedgerEntries'])
  assert.equal(r.CustLedgerEntry, 'BespoxAI_CustLedgerEntries')        // ours before the standard one
  assert.equal(r.VendorLedgerEntry, 'VendorLedgerEntries')              // only the standard one
  assert.equal(r.BankAccountLedgerEntry, 'BespoxAI_BankLedgerEntries')
  assert.equal(r.BankAccount, undefined)
})

test('ledger fields are narrowed to what the page exposes', () => {
  const meta = { entitySets: ['BespoxAI_CustLedgerEntries'], fields: { BespoxAI_CustLedgerEntries: ['Entry_No', 'Customer_No', 'Customer_Name', 'Due_Date', 'Remaining_Amt_LCY', 'Open', 'Date_Filter'] } }
  const cle = buildCatalogue(meta, null).find(c => c.logical === 'CustLedgerEntry')!
  assert.deepEqual(cle.fields, ['Entry_No', 'Customer_No', 'Customer_Name', 'Remaining_Amt_LCY', 'Due_Date', 'Open'])
})
