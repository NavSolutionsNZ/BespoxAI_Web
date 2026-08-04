/**
 * tests/bc-object-parser.test.ts
 *
 * Unit tests for the environment-index enrichment in lib/bc-object-parser.ts:
 * mod tag extraction, cross-object references, custom field flagging, and
 * version list capture — across C/AL exports and AL extension files.
 *
 * Run: npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseObjectFile, extractModTags } from '../lib/bc-object-parser'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CAL_TABLE = `OBJECT Table 36 Sales Header
{
  OBJECT-PROPERTIES
  {
    Date=04/08/26;
    Time=12:00:00;
    Modified=Yes;
    Version List=NAVW114.00,INC14.10,AP2267;
  }
  FIELDS
  {
    { 1   ;   ;Document Type       ;Option        }
    { 3   ;   ;No.                 ;Code20        }
    { 50000;  ;Send Statement      ;Boolean       ;Description=AP2267 }
    { 50010;  ;eDoc Email Subject  ;Text250       ;Description=AP2267 }
  }
  KEYS
  {
    {    ;Document Type,No.                       ;Clustered=Yes }
  }
}
`

const CAL_CODEUNIT = `OBJECT Codeunit 50009 JET TO ESKER XFR
{
  OBJECT-PROPERTIES
  {
    Version List=WEB1.00,AP2378;
  }
  PROPERTIES
  {
    OnRun=BEGIN
            // Start AP2378
            InvokeArTransfer;
            // Stop AP2378
          END;
  }
  CODE
  {
    VAR
      SalesHeader@1000 : Record 36;
      JobQueueEntry@1001 : Record 472;
      EmailMgt@1002 : Codeunit 50100;

    PROCEDURE InvokeArTransfer@1();
    BEGIN
      // AP2378 direct invocation bypassing Job Queue
      CODEUNIT.RUN(50100);
      REPORT.RUNMODAL(116, FALSE);
    END;

    BEGIN
    END.
  }
}
`

const CAL_PAGE = `OBJECT Page 21 Customer Card
{
  PROPERTIES
  {
    SourceTable=Table18;
  }
  CONTROLS
  {
    { 1 ;Action ;
      RunObject=Report 116 }
  }
}
`

const AL_TABLEEXT = `tableextension 50100 "Sales Line Ext" extends "Sales Line"
{
    fields
    {
        field(50000; "Vehicle Order No."; Code[20])
        {
            TableRelation = "Vehicle Order";
        }
        field(50001; "Unit Cost Synced"; Boolean)
        {
        }
    }
}
`

const AL_CODEUNIT = `codeunit 50110 "Statement Sender"
{
    var
        Customer: Record Customer;
        eDocSend: Codeunit "eDoc. Send";

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"Sales-Post", 'OnAfterPostSalesDoc', '', false, false)]
    local procedure OnAfterPost()
    begin
        // AP2267 queue statement after posting
        Page.Run(Page::"Customer Card");
    end;
}
`

// ── Multi-object split ────────────────────────────────────────────────────────

test('C/AL multi-object export splits into individual objects', () => {
  const combined = CAL_TABLE + '\n' + CAL_CODEUNIT + '\n' + CAL_PAGE
  const parsed = parseObjectFile(combined, 'export.txt')
  assert.equal(parsed.length, 3)
  assert.deepEqual(
    parsed.map(p => `${p.objectType} ${p.objectId}`),
    ['Table 36', 'Codeunit 50009', 'Page 21'],
  )
  assert.ok(parsed.every(p => !p.parseError))
})

// ── Mod tags ──────────────────────────────────────────────────────────────────

test('extractModTags finds Start/Stop wrappers, bare comments, Description= and Version List tags', () => {
  const tags = extractModTags(CAL_CODEUNIT)
  assert.deepEqual(tags, ['AP2378'])

  const tableTags = extractModTags(CAL_TABLE)
  assert.deepEqual(tableTags, ['AP2267'])
})

test('mod tags land in the parsed summary', () => {
  const [table] = parseObjectFile(CAL_TABLE, 't36.txt')
  assert.deepEqual(table.summary.modTags, ['AP2267'])

  const [cu] = parseObjectFile(CAL_CODEUNIT, 'cu50009.txt')
  assert.deepEqual(cu.summary.modTags, ['AP2378'])
})

test('extractModTags handles spacing and case variants without false positives', () => {
  const tags = extractModTags(`
    // start ap2381 sort by vendor name
    //STOP AP2381
    { AP202607 unit cost sync }
    // This APartment comment must not match
    // CAPACITY note must not match
  `)
  assert.deepEqual(tags, ['AP202607', 'AP2381'])
})

// ── Version list ──────────────────────────────────────────────────────────────

test('C/AL version list is captured', () => {
  const [table] = parseObjectFile(CAL_TABLE, 't36.txt')
  assert.equal(table.summary.versionList, 'NAVW114.00,INC14.10,AP2267')
})

// ── Custom fields ─────────────────────────────────────────────────────────────

test('C/AL fields in the 50000 range are flagged as custom', () => {
  const [table] = parseObjectFile(CAL_TABLE, 't36.txt')
  const ids = table.summary.customFields.map((f: any) => f.id)
  assert.deepEqual(ids, [50000, 50010])
  // Base fields must not be flagged
  assert.ok(!ids.includes(1) && !ids.includes(3))
})

test('AL tableextension fields are all custom by construction', () => {
  const [ext] = parseObjectFile(AL_TABLEEXT, 'SalesLineExt.al')
  assert.equal(ext.objectType.toLowerCase(), 'tableextension')
  assert.equal(ext.summary.customFields.length, 2)
  assert.equal(ext.summary.extends, 'Sales Line')
})

// ── References ────────────────────────────────────────────────────────────────

test('C/AL codeunit references: var declarations, direct RUN calls', () => {
  const [cu] = parseObjectFile(CAL_CODEUNIT, 'cu50009.txt')
  const refs = cu.summary.references as Array<{ objectType: string; objectId?: number; name?: string }>

  const has = (t: string, id: number) => refs.some(r => r.objectType === t && r.objectId === id)
  assert.ok(has('Table', 36),      'Record 36 var → Table 36')
  assert.ok(has('Table', 472),     'Record 472 var → Table 472')
  assert.ok(has('Codeunit', 50100),'Codeunit 50100 var + CODEUNIT.RUN')
  assert.ok(has('Report', 116),    'REPORT.RUNMODAL(116)')
})

test('C/AL page references: SourceTable and RunObject', () => {
  const [page] = parseObjectFile(CAL_PAGE, 'p21.txt')
  const refs = page.summary.references as Array<{ objectType: string; objectId?: number }>
  assert.ok(refs.some(r => r.objectType === 'Table'  && r.objectId === 18))
  assert.ok(refs.some(r => r.objectType === 'Report' && r.objectId === 116))
})

test('AL references: var declarations, scoped names, TableRelation, event subscribers', () => {
  const [cu] = parseObjectFile(AL_CODEUNIT, 'StatementSender.al')
  const refs = cu.summary.references as Array<{ objectType: string; name?: string }>

  const hasName = (t: string, n: string) =>
    refs.some(r => r.objectType === t && r.name?.toLowerCase() === n.toLowerCase())

  assert.ok(hasName('Table', 'Customer'),        'Record Customer var')
  assert.ok(hasName('Codeunit', 'eDoc. Send'),   'Codeunit var by name')
  assert.ok(hasName('Codeunit', 'Sales-Post'),   'Codeunit:: scoped ref')
  assert.ok(hasName('Page', 'Customer Card'),    'Page.Run(Page::...)')

  const [ext] = parseObjectFile(AL_TABLEEXT, 'ext.al')
  const extRefs = ext.summary.references as Array<{ objectType: string; name?: string }>
  assert.ok(extRefs.some(r => r.objectType === 'Table' && r.name === 'Vehicle Order'), 'TableRelation')
})

test('references are deduped', () => {
  const [cu] = parseObjectFile(CAL_CODEUNIT, 'cu.txt')
  const refs = cu.summary.references as Array<{ objectType: string; objectId?: number }>
  const cu50100 = refs.filter(r => r.objectType === 'Codeunit' && r.objectId === 50100)
  assert.equal(cu50100.length, 1, 'var + RUN of same codeunit collapse to one reference')
})

// ── Regression: existing summary keys still work ──────────────────────────────

test('existing field/procedure extraction is unchanged', () => {
  const [table] = parseObjectFile(CAL_TABLE, 't36.txt')
  assert.equal(table.summary.fields.length, 4)
  assert.equal(table.summary.fields[0].name, 'Document Type')

  const [cu] = parseObjectFile(CAL_CODEUNIT, 'cu.txt')
  assert.ok(cu.summary.procedures.some((p: any) => p.name === 'InvokeArTransfer'))
})
