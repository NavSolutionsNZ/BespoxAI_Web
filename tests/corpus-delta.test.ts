/**
 * Tests for the delta engine, C/AL → AL mapping rules and corpus selection.
 *
 * Run: npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { partHashes, normaliseObject, sha256, versionListOf, splitCalExport } from '../lib/corpus/cal-structure'
import {
  computeObjectDelta, computeDeltas, objectKey, addedVersionTags,
  type BaseIndexEntry, type TenantObjectInput,
} from '../lib/corpus/delta'
import { RULES, maxEffort } from '../lib/corpus/upgrade-rules'
import { selectCorpus } from '../lib/corpus/version-detect'

// ── fixtures ────────────────────────────────────────────────────────────────

const TABLE = [
  'OBJECT Table 18 Customer',
  '{',
  '  OBJECT-PROPERTIES',
  '  {',
  '    Date=19-12-12;',
  '    Time=12:00:00;',
  '    Version List=NAVW114.00,NAVNZ14.00;',
  '  }',
  '  PROPERTIES',
  '  {',
  '    OnInsert=BEGIN',
  '               InitNo;',
  '             END;',
  '',
  '    CaptionML=ENU=Customer;',
  '  }',
  '  FIELDS',
  '  {',
  '    { 1   ;   ;No.                 ;Code20        ;OnValidate=BEGIN',
  '                                                                TestNoSeries;',
  '                                                              END;',
  '                                                               }',
  '    { 2   ;   ;Name                ;Text50         }',
  '  }',
  '  KEYS',
  '  {',
  '    {    ;No.                                     ;Clustered=Yes }',
  '  }',
  '  CODE',
  '  {',
  '    VAR',
  '      SalesSetup@1000 : Record 311;',
  '',
  '    PROCEDURE TestNoSeries@1();',
  '    BEGIN',
  '      SalesSetup.GET;',
  '    END;',
  '',
  '    LOCAL PROCEDURE InitNo@2();',
  '    BEGIN',
  '    END;',
  '',
  '    BEGIN',
  '    {',
  '    }',
  '    END.',
  '  }',
  '}',
  '',
].join('\r\n')

const CODEUNIT = [
  'OBJECT Codeunit 80 Sales-Post',
  '{',
  '  OBJECT-PROPERTIES',
  '  {',
  '    Version List=NAVW114.00,NAVNZ14.00;',
  '  }',
  '  PROPERTIES',
  '  {',
  '    TableNo=36;',
  '    OnRun=BEGIN',
  '            Post(Rec);',
  '          END;',
  '',
  '  }',
  '  CODE',
  '  {',
  '',
  '    PROCEDURE Post@1(VAR SalesHeader@1000 : Record 36);',
  '    BEGIN',
  '      SalesHeader.TESTFIELD(Status);',
  '    END;',
  '',
  '    BEGIN',
  '    END.',
  '  }',
  '}',
  '',
].join('\r\n')

const PAGE = [
  'OBJECT Page 21 Customer Card',
  '{',
  '  OBJECT-PROPERTIES',
  '  {',
  '    Version List=NAVW114.00,NAVNZ14.00;',
  '  }',
  '  PROPERTIES',
  '  {',
  '    SourceTable=Table18;',
  '  }',
  '  CONTROLS',
  '  {',
  '    { 1   ;0   ;Container ;',
  '                ContainerType=ContentArea }',
  '    { 2   ;1   ;Field     ;',
  '                SourceExpr="No." }',
  '    { 3   ;1   ;Field     ;',
  '                SourceExpr=Name }',
  '  }',
  '  CODE',
  '  {',
  '',
  '    BEGIN',
  '    END.',
  '  }',
  '}',
  '',
].join('\r\n')

const REPORT = [
  'OBJECT Report 206 Sales - Invoice',
  '{',
  '  OBJECT-PROPERTIES',
  '  {',
  '    Version List=NAVW114.00,NAVNZ14.00;',
  '  }',
  '  PROPERTIES',
  '  {',
  '  }',
  '  DATASET',
  '  {',
  '    { 1   ;    ;DataItem;                    ;',
  '               DataItemTable=Table112 }',
  '  }',
  '  CODE',
  '  {',
  '',
  '    BEGIN',
  '    END.',
  '  }',
  '  RDLDATA',
  '  {',
  '    <Report>original</Report>',
  '  }',
  '}',
  '',
].join('\r\n')

function baseEntry(text: string): BaseIndexEntry {
  const b = splitCalExport(text)[0]
  return {
    objectType: b.objectType, objectId: b.objectId, objectName: b.objectName,
    versionList: versionListOf(text), normHash: sha256(normaliseObject(text)), partHashes: partHashes(text),
  }
}

function tenantObj(text: string): TenantObjectInput {
  const b = splitCalExport(text)[0]
  return { objectType: b.objectType, objectId: b.objectId, objectName: b.objectName, text }
}

function tag(text: string, t = 'CUST1.00'): string {
  return text.replace('NAVW114.00,NAVNZ14.00;', 'NAVW114.00,NAVNZ14.00,' + t + ';')
}

const codes = (d: { findings: Array<{ code: string }> }) => d.findings.map(f => f.code).sort()

// ── origin classification ───────────────────────────────────────────────────

test('re-exported standard object with new date/time is unmodified', () => {
  const t = TABLE.replace('Date=19-12-12;', 'Date=03-10-26;')
  const d = computeObjectDelta(tenantObj(t), baseEntry(TABLE))
  assert.equal(d.origin, 'standard_unmodified')
  assert.equal(d.effort, 'none')
})

test('new object in the customer range is custom_new → Txt2AL, low', () => {
  const t = CODEUNIT.replace('Codeunit 80 Sales-Post', 'Codeunit 50010 Loyalty Mgt.')
  const d = computeObjectDelta(tenantObj(t), undefined)
  assert.equal(d.origin, 'custom_new')
  assert.deepEqual(codes(d), ['new_object'])
  assert.equal(d.effort, 'low')
})

test('object outside the customer range and not in base is isv_or_unknown', () => {
  const t = CODEUNIT.replace('Codeunit 80 Sales-Post', 'Codeunit 14125500 Vendor Thing')
  const d = computeObjectDelta(tenantObj(t), undefined)
  assert.equal(d.origin, 'isv_or_unknown')
  assert.deepEqual(codes(d), ['isv_object'])
})

test('per-tenant custom ranges are honoured', () => {
  const t = CODEUNIT.replace('Codeunit 80 Sales-Post', 'Codeunit 14125510 Licensed Range')
  const d = computeObjectDelta(tenantObj(t), undefined, [{ from: 50000, to: 99999 }, { from: 14125500, to: 14125599 }])
  assert.equal(d.origin, 'custom_new')
})

test('custom forms and dataports are legacy (medium)', () => {
  const t = PAGE.replace('Page 21 Customer Card', 'Form 50000 Old Form')
  assert.deepEqual(codes(computeObjectDelta(tenantObj(t), undefined)), ['new_legacy_object'])
})

// ── tables ──────────────────────────────────────────────────────────────────

test('field added on a standard table in range → tableextension, low', () => {
  const t = tag(TABLE.replace(
    '    { 2   ;   ;Name                ;Text50         }',
    '    { 2   ;   ;Name                ;Text50         }\r\n    { 50000;  ;Loyalty Tier        ;Code10         }'))
  const d = computeObjectDelta(tenantObj(t), baseEntry(TABLE))
  assert.equal(d.origin, 'standard_modified')
  assert.deepEqual(d.modTags, ['CUST1.00'])
  assert.equal(d.unattributed, false)
  assert.deepEqual(codes(d), ['field_added'])
  assert.deepEqual(d.findings[0].items, ['50000'])
  assert.equal(d.effort, 'low')
})

test('field added outside the customer range → renumber, medium', () => {
  const t = TABLE.replace(
    '    { 2   ;   ;Name                ;Text50         }',
    '    { 2   ;   ;Name                ;Text50         }\r\n    { 150 ;   ;Region              ;Code10         }')
  const d = computeObjectDelta(tenantObj(t), baseEntry(TABLE))
  assert.deepEqual(codes(d), ['field_added_out_of_range'])
  assert.equal(d.effort, 'medium')
  assert.equal(d.unattributed, true, 'no version tag was added')
})

test('changed standard field definition → high', () => {
  const d = computeObjectDelta(tenantObj(TABLE.replace('Text50 ', 'Text100')), baseEntry(TABLE))
  assert.deepEqual(codes(d), ['field_definition_changed'])
  assert.deepEqual(d.findings[0].items, ['2'])
  assert.equal(d.effort, 'high')
})

test('code added to a standard field trigger → platform field event, low', () => {
  const d = computeObjectDelta(tenantObj(TABLE.replace('TestNoSeries;', 'TestNoSeries; CheckLoyalty;')), baseEntry(TABLE))
  assert.deepEqual(codes(d), ['field_trigger_code'])
  assert.deepEqual(d.findings[0].items, ['1 (OnValidate)'])
})

test('code in a standard table trigger → object_trigger_code, medium', () => {
  const d = computeObjectDelta(tenantObj(TABLE.replace('InitNo;', 'InitNo; SetLoyalty;')), baseEntry(TABLE))
  assert.deepEqual(codes(d), ['object_trigger_code'])
  assert.deepEqual(d.findings[0].items, ['OnInsert'])
  assert.equal(d.effort, 'medium')
})

test('key added → low; key changed → high', () => {
  const added = TABLE.replace(
    '    {    ;No.                                     ;Clustered=Yes }',
    '    {    ;No.                                     ;Clustered=Yes }\r\n    {    ;Name                                     }')
  assert.deepEqual(codes(computeObjectDelta(tenantObj(added), baseEntry(TABLE))), ['key_added'])
  const changed = TABLE.replace('Clustered=Yes', 'Clustered=No')
  assert.deepEqual(codes(computeObjectDelta(tenantObj(changed), baseEntry(TABLE))), ['key_changed_or_removed'])
})

test('procedure added / changed / removed on a standard object', () => {
  const addedProc = TABLE.replace('    LOCAL PROCEDURE InitNo@2();',
    '    PROCEDURE CalcLoyalty@50000();\r\n    BEGIN\r\n    END;\r\n\r\n    LOCAL PROCEDURE InitNo@2();')
  assert.deepEqual(codes(computeObjectDelta(tenantObj(addedProc), baseEntry(TABLE))), ['procedure_added'])

  const changed = TABLE.replace('      SalesSetup.GET;', '      SalesSetup.GET;\r\n      CheckCredit;')
  const dc = computeObjectDelta(tenantObj(changed), baseEntry(TABLE))
  assert.deepEqual(codes(dc), ['procedure_changed'])
  assert.deepEqual(dc.findings[0].items, ['TestNoSeries'])
  assert.match(dc.findings[0].alTarget, /confirm publisher/)

  const removed = TABLE.replace('    LOCAL PROCEDURE InitNo@2();\r\n    BEGIN\r\n    END;\r\n\r\n', '')
  assert.deepEqual(codes(computeObjectDelta(tenantObj(removed), baseEntry(TABLE))), ['procedure_removed'])
})

test('documentation-only change → doc_only, no effort', () => {
  const t = tag(TABLE.replace('    BEGIN\r\n    {\r\n    }\r\n    END.', '    BEGIN\r\n    {\r\n      CUST1.00 2026 note\r\n    }\r\n    END.'))
  const d = computeObjectDelta(tenantObj(t), baseEntry(TABLE))
  assert.equal(d.origin, 'standard_modified')
  assert.deepEqual(codes(d), ['doc_only'])
  assert.equal(d.effort, 'none')
})

test('several changes combine; effort is the maximum', () => {
  const t = TABLE.replace('Text50 ', 'Text100').replace('TestNoSeries;', 'TestNoSeries; X;')
  const d = computeObjectDelta(tenantObj(t), baseEntry(TABLE))
  assert.deepEqual(codes(d), ['field_definition_changed', 'field_trigger_code'])
  assert.equal(d.effort, 'high')
})

// ── codeunits, pages, reports ───────────────────────────────────────────────

test('code changed inside a standard codeunit procedure → event subscriber', () => {
  const d = computeObjectDelta(tenantObj(CODEUNIT.replace('TESTFIELD(Status);', 'TESTFIELD(Status);\r\n      CheckLoyalty(SalesHeader);')), baseEntry(CODEUNIT))
  assert.deepEqual(codes(d), ['procedure_changed'])
  assert.deepEqual(d.findings[0].items, ['Post'])
})

test('code changed in codeunit OnRun → object_trigger_code', () => {
  const d = computeObjectDelta(tenantObj(CODEUNIT.replace('Post(Rec);', 'Post(Rec); Notify;')), baseEntry(CODEUNIT))
  assert.deepEqual(codes(d), ['object_trigger_code'])
})

test('page control added / removed / changed', () => {
  const added = PAGE.replace('                SourceExpr=Name }',
    '                SourceExpr=Name }\r\n    { 50000;1  ;Field     ;\r\n                SourceExpr="Loyalty Tier" }')
  assert.deepEqual(codes(computeObjectDelta(tenantObj(added), baseEntry(PAGE))), ['control_added'])

  const removed = PAGE.replace('    { 3   ;1   ;Field     ;\r\n                SourceExpr=Name }\r\n', '')
  assert.deepEqual(codes(computeObjectDelta(tenantObj(removed), baseEntry(PAGE))), ['control_removed'])

  const changed = PAGE.replace('SourceExpr=Name }', 'SourceExpr=Name;\r\n                Importance=Promoted }')
  assert.deepEqual(codes(computeObjectDelta(tenantObj(changed), baseEntry(PAGE))), ['control_changed'])
})

test('report: dataset change → copy and substitute; layout only → custom layout', () => {
  const ds = REPORT.replace('DataItemTable=Table112 }', 'DataItemTable=Table112;\r\n               ReqFilterFields=No. }')
  assert.deepEqual(codes(computeObjectDelta(tenantObj(ds), baseEntry(REPORT))), ['report_modified'])
  const layout = REPORT.replace('<Report>original</Report>', '<Report>customer logo</Report>')
  const d = computeObjectDelta(tenantObj(layout), baseEntry(REPORT))
  assert.deepEqual(codes(d), ['report_layout_only'])
  assert.equal(d.effort, 'low')
})

// ── whole tenant ────────────────────────────────────────────────────────────

test('computeDeltas summarises a seeded customer export', () => {
  const base = new Map<string, BaseIndexEntry>()
  for (const t of [TABLE, CODEUNIT, PAGE, REPORT]) {
    const e = baseEntry(t); base.set(objectKey(e.objectType, e.objectId), e)
  }
  const tenant = [
    tag(TABLE.replace('    { 2   ;   ;Name                ;Text50         }',
      '    { 2   ;   ;Name                ;Text50         }\r\n    { 50000;  ;Loyalty Tier        ;Code10         }')),
    tag(CODEUNIT.replace('TESTFIELD(Status);', 'TESTFIELD(Status);\r\n      CheckLoyalty(SalesHeader);')),
    PAGE,
    REPORT.replace('<Report>original</Report>', '<Report>logo</Report>'),
    CODEUNIT.replace('Codeunit 80 Sales-Post', 'Codeunit 50010 Loyalty Mgt.'),
    CODEUNIT.replace('Codeunit 80 Sales-Post', 'Codeunit 14125500 Vendor Thing'),
  ].map(tenantObj)

  const { summary } = computeDeltas(tenant, base)
  assert.equal(summary.total, 6)
  assert.deepEqual(summary.byOrigin, { standard_unmodified: 1, standard_modified: 3, custom_new: 1, isv_or_unknown: 1 })
  assert.deepEqual(summary.byEffort, { none: 2, low: 3, medium: 1, high: 0 })
  assert.equal(summary.unattributed, 1, 'the report change carries no version tag')
  assert.deepEqual(summary.findingsByCode, {
    field_added: 1, procedure_changed: 1, report_layout_only: 1, new_object: 1, isv_object: 1,
  })
})

test('stale base index (old part-hash schema) is rejected with a clear error', () => {
  const stale = { ...baseEntry(TABLE), partHashes: { ...partHashes(TABLE), schema: 1 } }
  assert.throws(() => computeObjectDelta(tenantObj(TABLE.replace('Text50 ', 'Text100')), stale), /re-run ingest-base-corpus/)
})

// ── helpers & rules table ───────────────────────────────────────────────────

test('addedVersionTags ignores Microsoft tags and is case-insensitive', () => {
  assert.deepEqual(addedVersionTags('NAVW114.00,NAVNZ14.00,cust1.00,AP2267', 'NAVW114.00,NAVNZ14.00,CUST1.00'), ['AP2267'])
  assert.deepEqual(addedVersionTags('NAVW114.00.29537,NAVNZ14.00', 'NAVW114.00,NAVNZ14.00'), [])
})

test('every rule has a target, an effort and a note', () => {
  for (const [code, r] of Object.entries(RULES)) {
    assert.ok(r.alTarget && r.note, code)
    assert.ok(['none', 'low', 'medium', 'high'].includes(r.effort), code)
  }
  assert.equal(maxEffort([]), 'none')
})

// ── corpus selection ────────────────────────────────────────────────────────

const CORPORA = [
  { id: 'nz1', version: 'BC14', build: '14.0.29537.0', localisation: 'NZ', versionTag: 'NAVNZ14.00', status: 'ready' },
  { id: 'w1',  version: 'BC14', build: '14.0.29537.0', localisation: 'W1', versionTag: 'NAVW114.00', status: 'ready' },
]

test('selectCorpus: exact localisation match is high confidence', () => {
  const m = selectCorpus(['NAVW114.00,NAVNZ14.00', 'NAVW114.00,NAVNZ14.00,CUST1'], CORPORA)
  assert.equal(m.corpus?.id, 'nz1')
  assert.equal(m.confidence, 'high')
  assert.equal(m.detected.localisation, 'NZ')
})

test('selectCorpus: multiple builds → newest, medium', () => {
  const m = selectCorpus(['NAVW114.00,NAVNZ14.00'], CORPORA.concat([
    { id: 'nz2', version: 'BC14', build: '14.0.40000.0', localisation: 'NZ', versionTag: 'NAVNZ14.00', status: 'ready' },
  ]))
  assert.equal(m.corpus?.id, 'nz2')
  assert.equal(m.confidence, 'medium')
})

test('selectCorpus: unknown localisation falls back to W1 with low confidence', () => {
  const m = selectCorpus(['NAVW114.00,NAVAU14.00'], CORPORA)
  assert.equal(m.corpus?.id, 'w1')
  assert.equal(m.confidence, 'low')
})

test('selectCorpus: nothing loaded for the version → none', () => {
  const m = selectCorpus(['NAVW111.00,NAVNZ11.00'], CORPORA)
  assert.equal(m.corpus, null)
  assert.equal(m.confidence, 'none')
})

test('selectCorpus: corpora still ingesting are ignored', () => {
  const m = selectCorpus(['NAVW114.00,NAVNZ14.00'], [{ ...CORPORA[0], status: 'ingesting' }])
  assert.equal(m.corpus, null)
})
