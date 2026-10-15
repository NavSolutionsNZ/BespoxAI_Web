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
  partHashes, sha256, versionListOf, dominantVersionTags,
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
  assert.equal(mod.fields['1'], base.fields['1'])
  assert.notEqual(mod.fields['2'], base.fields['2'])
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

test('partHashes keys object triggers under properties', () => {
  const base = partHashes(TABLE)
  assert.deepEqual(Object.keys(base.properties), ['Permissions', 'OnInsert', 'CaptionML'])
  const mod = partHashes(TABLE.replace('NoSeriesMgt.InitSeries;', 'NoSeriesMgt.InitSeries; MyHook;'))
  assert.notEqual(mod.properties['OnInsert'], base.properties['OnInsert'])
  assert.equal(mod.properties['Permissions'], base.properties['Permissions'])
})

test('KEYS and other sections are hashed whole', () => {
  const base = partHashes(TABLE)
  assert.ok(base.sections['KEYS'])
  const mod = partHashes(TABLE.replace('Clustered=Yes', 'Clustered=No'))
  assert.notEqual(mod.sections['KEYS'], base.sections['KEYS'])
})

test('a codeunit with only a trigger and empty documentation parses', () => {
  const p = partHashes(CODEUNIT)
  assert.deepEqual(Object.keys(p.properties), ['OnRun'])
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
