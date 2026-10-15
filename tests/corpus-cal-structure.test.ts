/**
 * Tests for lib/corpus/cal-structure.ts — splitting, normalisation and
 * part hashing of C/AL text exports.
 *
 * Run: npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  splitCalExport, objectFileName, calSections, normaliseObject,
  partHashes, splitTriggers, sha256, versionListOf, dominantVersionTags,
} from '../lib/corpus/cal-structure'

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
  '    Permissions=TableData 21=r;',
  '    OnInsert=BEGIN',
  '               IF "No." = \'\' THEN',
  '                 NoSeriesMgt.InitSeries;',
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
  '      NoSeriesMgt@1000 : Codeunit 396;',
  '',
  '    PROCEDURE TestNoSeries@1();',
  '    BEGIN',
  '      SalesSetup.GET;',
  '    END;',
  '',
  '    LOCAL PROCEDURE "Check Blocked"@2();',
  '    BEGIN',
  '      TESTFIELD(Blocked,0);',
  '    END;',
  '',
  '    BEGIN',
  '    {',
  '      Standard object',
  '    }',
  '    END.',
  '  }',
  '}',
  '',
].join('\r\n')

const CODEUNIT = [
  'OBJECT Codeunit 50000 My Custom',
  '{',
  '  OBJECT-PROPERTIES',
  '  {',
  '    Version List=CUST1.00;',
  '  }',
  '  PROPERTIES',
  '  {',
  '    OnRun=BEGIN',
  '          END;',
  '',
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

test('splitCalExport splits a multi-object export and preserves exact text', () => {
  const blocks = splitCalExport(TABLE + CODEUNIT)
  assert.equal(blocks.length, 2)
  assert.deepEqual(blocks.map(b => [b.objectType, b.objectId, b.objectName]),
    [['Table', 18, 'Customer'], ['Codeunit', 50000, 'My Custom']])
  assert.equal(blocks[0].text + blocks[1].text, TABLE + CODEUNIT)
})

test('split round-trips OEM bytes when read and written as latin1', () => {
  const oem = Buffer.from([0x81, 0x94, 0x9a, 0xe1])           // ü ö Ü ß in CP850
  const content = Buffer.concat([Buffer.from(TABLE.replace('Customer;', 'Kunde '), 'latin1'), oem])
  const text = content.toString('latin1')
  const blocks = splitCalExport(text)
  assert.ok(Buffer.from(blocks[0].text, 'latin1').equals(content))
})

test('objectFileName uses C/SIDE prefixes', () => {
  assert.equal(objectFileName('Table', 18), 'TAB18.TXT')
  assert.equal(objectFileName('Codeunit', 80), 'COD80.TXT')
  assert.equal(objectFileName('XMLport', 1), 'XML1.TXT')
  assert.throws(() => objectFileName('Widget', 1))
})

test('calSections finds top-level sections', () => {
  const s = calSections(TABLE.replace(/\r\n/g, '\n'))
  assert.deepEqual(Array.from(s.keys()), ['OBJECT-PROPERTIES', 'PROPERTIES', 'FIELDS', 'KEYS', 'CODE'])
})

test('normalised hash ignores OBJECT-PROPERTIES, line endings and trailing spaces', () => {
  const restamped = TABLE
    .replace('Date=19-12-12;', 'Date=01-01-26;')
    .replace('Version List=NAVW114.00,NAVNZ14.00;', 'Version List=NAVW114.00,NAVNZ14.00,CUST1;')
    .replace(/\r\n/g, '\n')
    .replace('Name                ;Text50         }', 'Name                ;Text50         }   ')
  assert.equal(sha256(normaliseObject(restamped)), sha256(normaliseObject(TABLE)))
})

test('normalised hash changes when code changes, including comments', () => {
  const commented = TABLE.replace('      SalesSetup.GET;', '      //SalesSetup.GET;')
  assert.notEqual(sha256(normaliseObject(commented)), sha256(normaliseObject(TABLE)))
})

test('partHashes isolates a changed field', () => {
  const base = partHashes(TABLE)
  const mod = partHashes(TABLE.replace('Text50 ', 'Text100'))
  assert.deepEqual(Object.keys(base.fields), ['1', '2'])
  assert.deepEqual(mod.fields['1'], base.fields['1'])
  assert.notEqual(mod.fields['2'].def, base.fields['2'].def)
  assert.deepEqual(mod.procedures, base.procedures)
})

test('partHashes detects an added field', () => {
  const added = TABLE.replace(
    '    { 2   ;   ;Name                ;Text50         }',
    '    { 2   ;   ;Name                ;Text50         }\r\n    { 50000;  ;Loyalty Tier        ;Code10         }',
  )
  assert.deepEqual(Object.keys(partHashes(added).fields), ['1', '2', '50000'])
})

test('partHashes splits procedures, globals and documentation separately', () => {
  const base = partHashes(TABLE)
  assert.deepEqual(Object.keys(base.procedures), ['TestNoSeries', 'Check Blocked'])
  assert.ok(base.globals)
  assert.ok(base.documentation)

  const proc = partHashes(TABLE.replace('TESTFIELD(Blocked,0);', 'TESTFIELD(Blocked,1);'))
  assert.equal(proc.procedures['TestNoSeries'], base.procedures['TestNoSeries'])
  assert.notEqual(proc.procedures['Check Blocked'], base.procedures['Check Blocked'])
  assert.equal(proc.documentation, base.documentation)

  const doc = partHashes(TABLE.replace('Standard object', 'CUST1 changed'))
  assert.notEqual(doc.documentation, base.documentation)
  assert.deepEqual(doc.procedures, base.procedures)
})

test('partHashes separates object triggers from properties', () => {
  const base = partHashes(TABLE)
  assert.deepEqual(Object.keys(base.properties), ['Permissions', 'CaptionML'])
  assert.deepEqual(Object.keys(base.triggers), ['OnInsert'])
  const mod = partHashes(TABLE.replace('NoSeriesMgt.InitSeries;', 'NoSeriesMgt.InitSeries; MyHook;'))
  assert.notEqual(mod.triggers['OnInsert'], base.triggers['OnInsert'])
  assert.deepEqual(mod.properties, base.properties)
})

test('field trigger code is hashed apart from the field definition', () => {
  const base = partHashes(TABLE)
  assert.deepEqual(Object.keys(base.fields['1'].triggers), ['OnValidate'])
  const code = partHashes(TABLE.replace('TestNoSeries;', 'TestNoSeries; CheckCustom;'))
  assert.equal(code.fields['1'].def, base.fields['1'].def)
  assert.notEqual(code.fields['1'].triggers['OnValidate'], base.fields['1'].triggers['OnValidate'])
  const def = partHashes(TABLE.replace('No.                 ;Code20 ', 'No.                 ;Code30 '))
  assert.notEqual(def.fields['1'].def, base.fields['1'].def)
  assert.deepEqual(def.fields['1'].triggers, base.fields['1'].triggers)
})

test('splitTriggers handles VAR blocks, nested END; and properties after the trigger', () => {
  const entry = [
    '{ 5   ;   ;Amount              ;Decimal       ;OnValidate=VAR',
    '                                                                X@1000 : Integer;',
    '                                                              BEGIN',
    '                                                                IF X = 0 THEN BEGIN',
    '                                                                  X := 1;',
    '                                                                END;',
    '                                                              END;',
    '',
    '                                                   CaptionML=ENU=Amount }',
  ].join('\n')
  const r = splitTriggers(entry)
  assert.deepEqual(Object.keys(r.triggers), ['OnValidate'])
  assert.ok(r.def.includes('CaptionML=ENU=Amount'))
  assert.ok(!r.def.includes('X := 1'))
})

test('KEYS are keyed by their field list', () => {
  const base = partHashes(TABLE)
  assert.deepEqual(Object.keys(base.keys), ['No.'])
  const mod = partHashes(TABLE.replace('Clustered=Yes', 'Clustered=No'))
  assert.notEqual(mod.keys['No.'], base.keys['No.'])
  const added = partHashes(TABLE.replace(
    '    {    ;No.                                     ;Clustered=Yes }',
    '    {    ;No.                                     ;Clustered=Yes }\r\n    {    ;Name                                     }'))
  assert.deepEqual(Object.keys(added.keys), ['No.', 'Name'])
  assert.equal(added.keys['No.'], base.keys['No.'])
})

test('page action list entries are hashed by id', () => {
  const page = [
    'OBJECT Page 21 Customer Card', '{', '  PROPERTIES', '  {',
    '    SourceTable=Table18;',
    '    ActionList=ACTIONS',
    '    {',
    '      { 1900000003;0 ;ActionContainer;',
    '                      ActionContainerType=RelatedInformation }',
    '      { 10      ;1   ;Action    ;',
    '                      CaptionML=ENU=Ledger;',
    '                      OnAction=BEGIN',
    '                                 ShowLedger;',
    '                               END;',
    '                                }',
    '    }',
    '    }', '', '  }', '  CONTROLS', '  {',
    '    { 1   ;0   ;Container ;',
    '                ContainerType=ContentArea }',
    '    { 2   ;1   ;Field     ;',
    '                SourceExpr="No." }',
    '  }', '}', '',
  ].join('\n')
  const base = partHashes(page)
  assert.deepEqual(Object.keys(base.actions).sort(), ['10', '1900000003'])
  assert.deepEqual(Object.keys(base.actions['10'].triggers), ['OnAction'])
  assert.deepEqual(Object.keys(base.controls), ['1', '2'])
  assert.deepEqual(Object.keys(base.properties), ['SourceTable'])
  const mod = partHashes(page.replace('ShowLedger;', 'ShowLedger; Extra;'))
  assert.equal(mod.actions['10'].def, base.actions['10'].def)
  assert.notEqual(mod.actions['10'].triggers['OnAction'], base.actions['10'].triggers['OnAction'])
})

test('a codeunit with only a trigger and empty documentation parses', () => {
  const p = partHashes(CODEUNIT)
  assert.deepEqual(Object.keys(p.triggers), ['OnRun'])
  assert.equal(p.schema, 2)
  assert.deepEqual(p.procedures, {})
  assert.ok(p.documentation)
})

test('versionListOf and dominantVersionTags', () => {
  assert.equal(versionListOf(TABLE), 'NAVW114.00,NAVNZ14.00')
  assert.deepEqual(
    dominantVersionTags(['NAVW114.00,NAVNZ14.00', 'NAVW114.00.29537', 'NAVW113.00', null, 'CUST1.00']),
    { w1: 'NAVW114.00', local: 'NAVNZ14.00' },
  )
})
