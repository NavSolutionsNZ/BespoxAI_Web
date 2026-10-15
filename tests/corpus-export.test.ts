/**
 * Tests for full-export job rules and the processing core (design §14).
 *
 * Run: npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'zlib'
import {
  isOutOfHours, hourInZone, tenantTimeZone, newJobToken, jobTokenMatches, hashJobToken,
  licenceFetchRefusal, isStale, assembleChunks, parseRepoOverride, LICENCE_EARLY_MS, RUN_GRACE_MS,
  PROCESSING_GRACE_MS, FULL_EXPORT_PREFIX,
} from '../lib/corpus/export-jobs'
import {
  decodeExport, processExportText, tenantObjectsFromText, tenantCustomRanges, type ProcessIO, type BaseLiteRow,
} from '../lib/corpus/process-export-core'
import { partHashes, normaliseObject, sha256, versionListOf, splitCalExport } from '../lib/corpus/cal-structure'
import { DEFAULT_CUSTOM_RANGES } from '../lib/corpus/delta'
import { validateLicenceUpload, licenceProblem, licenceOwnerForTenant } from '../lib/licence-rules'
import { gitBlobShaForLatin1 } from '../lib/github'

// ── time windows ────────────────────────────────────────────────────────────

test('out-of-hours is 22:00–05:00 in the tenant zone', () => {
  const tz = 'Pacific/Auckland'                    // NZDT = UTC+13 in October
  assert.equal(hourInZone(new Date('2026-10-15T10:00:00Z'), tz), 23)
  assert.equal(isOutOfHours(new Date('2026-10-15T10:00:00Z'), tz), true)   // 23:00
  assert.equal(isOutOfHours(new Date('2026-10-15T15:59:00Z'), tz), true)   // 04:59
  assert.equal(isOutOfHours(new Date('2026-10-15T16:00:00Z'), tz), false)  // 05:00
  assert.equal(isOutOfHours(new Date('2026-10-15T08:59:00Z'), tz), false)  // 21:59
  assert.equal(isOutOfHours(new Date('2026-10-15T09:00:00Z'), tz), true)   // 22:00
})

test('tenant time zone: explicit, then country, then UTC', () => {
  assert.equal(tenantTimeZone({ timeZone: 'Australia/Perth', country: 'NZ' }), 'Australia/Perth')
  assert.equal(tenantTimeZone({ timeZone: 'Not/AZone', country: 'NZ' }), 'Pacific/Auckland')
  assert.equal(tenantTimeZone({ country: 'au' }), 'Australia/Sydney')
  assert.equal(tenantTimeZone({ country: 'XX' }), 'UTC')
})

// ── tokens ──────────────────────────────────────────────────────────────────

test('job tokens: random, stored as hash, compared in constant time', () => {
  const a = newJobToken(), b = newJobToken()
  assert.notEqual(a.token, b.token)
  assert.equal(a.hash, hashJobToken(a.token))
  assert.equal(jobTokenMatches(a.token, a.hash), true)
  assert.equal(jobTokenMatches(b.token, a.hash), false)
  assert.equal(jobTokenMatches(null, a.hash), false)
  assert.equal(jobTokenMatches('', a.hash), false)
})

// ── state rules ─────────────────────────────────────────────────────────────

const T0 = new Date('2026-10-15T10:00:00Z')
const job = (over: Partial<{ status: string; licenceFetchedAt: Date | null; updatedAt: Date }> = {}) => ({
  status: 'scheduled', notBefore: T0, licenceFetchedAt: null as Date | null, updatedAt: T0, ...over,
})

test('licence may be fetched once, only in the job window', () => {
  assert.match(licenceFetchRefusal(job(), new Date(T0.getTime() - LICENCE_EARLY_MS - 1000))!, /Too early/)
  assert.equal(licenceFetchRefusal(job(), new Date(T0.getTime() - LICENCE_EARLY_MS + 1000)), null)
  assert.equal(licenceFetchRefusal(job(), new Date(T0.getTime() + 60_000)), null)
  assert.match(licenceFetchRefusal(job(), new Date(T0.getTime() + RUN_GRACE_MS + 1000))!, /passed/)
  assert.match(licenceFetchRefusal(job({ licenceFetchedAt: T0 }), T0)!, /already issued/)
  assert.match(licenceFetchRefusal(job({ status: 'running' }), T0)!, /running/)
})

test('stale detection per status', () => {
  assert.equal(isStale(job(), new Date(T0.getTime() + RUN_GRACE_MS - 1000)), false)
  assert.equal(isStale(job(), new Date(T0.getTime() + RUN_GRACE_MS + 1000)), true)
  assert.equal(isStale(job({ status: 'running' }), new Date(T0.getTime() + RUN_GRACE_MS + 1000)), true)
  assert.equal(isStale(job({ status: 'uploaded' }), new Date(T0.getTime() + PROCESSING_GRACE_MS + 1000)), true)
  assert.equal(isStale(job({ status: 'processing' }), new Date(T0.getTime() + PROCESSING_GRACE_MS - 1000)), false)
  assert.equal(isStale(job({ status: 'complete' }), new Date(T0.getTime() + 10 * RUN_GRACE_MS)), false)
})

// ── chunks ──────────────────────────────────────────────────────────────────

test('assembleChunks orders, and rejects gaps or count mismatches', () => {
  const c = [{ seq: 1, data: Buffer.from('b') }, { seq: 0, data: Buffer.from('a') }, { seq: 2, data: Buffer.from('c') }]
  assert.equal(assembleChunks(c, 3).toString(), 'abc')
  assert.throws(() => assembleChunks(c, 4), /Expected 4/)
  assert.throws(() => assembleChunks([{ seq: 0, data: Buffer.from('a') }, { seq: 2, data: Buffer.from('c') }], 2), /Chunk 1 is missing/)
  assert.throws(() => assembleChunks(c, 0), /Invalid chunk count/)
})

test('parseRepoOverride', () => {
  assert.deepEqual(parseRepoOverride('acme-consulting/widgets-ltd-nav'), { owner: 'acme-consulting', repo: 'widgets-ltd-nav' })
  assert.equal(parseRepoOverride('no-slash'), null)
  assert.equal(parseRepoOverride(null), null)
})

// ── licence rules ───────────────────────────────────────────────────────────

test('licence upload validation and usability', () => {
  assert.equal(validateLicenceUpload('NavSolutions.flf', Buffer.alloc(9000)), null)
  assert.equal(validateLicenceUpload('dev.bclicense', Buffer.alloc(9000)), null)
  assert.match(validateLicenceUpload('licence.txt', Buffer.alloc(10))!, /\.flf/)
  assert.match(validateLicenceUpload('x.flf', Buffer.alloc(0))!, /empty/)
  assert.match(validateLicenceUpload('x.flf', Buffer.alloc(600 * 1024))!, /512 KB/)

  const meta = { fileName: 'x.flf', sizeBytes: 1, sha256: 'a', expiresAt: null, uploadedById: 'u', uploadedAt: T0 }
  assert.match(licenceProblem(null)!, /No developer licence/)
  assert.equal(licenceProblem(meta), null)
  assert.match(licenceProblem({ ...meta, expiresAt: new Date('2026-01-01') }, T0)!, /expired on 2026-01-01/)

  assert.equal(licenceOwnerForTenant({ partnerAccountId: null }), null)
  assert.equal(licenceOwnerForTenant({ partnerAccountId: 'p1' }), 'p1')
})

// ── git blob sha (skip unchanged files) ─────────────────────────────────────

test('gitBlobShaForLatin1 matches git for ASCII and maps OEM bytes reversibly', () => {
  // `printf 'hello\n' | git hash-object --stdin`
  assert.equal(gitBlobShaForLatin1('hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a')
  const oem = Buffer.from([0x81, 0x94]).toString('latin1')
  assert.equal(Buffer.from(Buffer.from(oem, 'utf8').toString('utf8'), 'latin1').equals(Buffer.from([0x81, 0x94])), true)
})

// ── processing core ─────────────────────────────────────────────────────────

const OBJ = (type: string, id: number, name: string, extra = '', vl = 'NAVW114.27,NAVAPAC14.27') => [
  'OBJECT ' + type + ' ' + id + ' ' + name,
  '{',
  '  OBJECT-PROPERTIES',
  '  {',
  '    Date=01-01-26;',
  '    Version List=' + vl + ';',
  '  }',
  '  PROPERTIES',
  '  {',
  '    OnRun=BEGIN',
  '            Go;' + extra,
  '          END;',
  '',
  '  }',
  '  CODE',
  '  {',
  '',
  '    PROCEDURE Go@1();',
  '    BEGIN',
  '    END;',
  '',
  '    BEGIN',
  '    END.',
  '  }',
  '}',
  '',
].join('\r\n')

const BASE_TEXTS = [
  OBJ('Codeunit', 80, 'Sales-Post'),
  OBJ('Codeunit', 90, 'Purch.-Post'),
  OBJ('Codeunit', 12, 'Gen. Jnl.-Post Line', '', 'NAVW114.27,NAVNZ14.27'),
]

function fakeIO(calls: { parts: string[][] }): ProcessIO {
  const lite: BaseLiteRow[] = BASE_TEXTS.map((t, i) => {
    const b = splitCalExport(t)[0]
    return { id: 'b' + i, objectType: b.objectType, objectId: b.objectId, objectName: b.objectName, versionList: versionListOf(t), normHash: sha256(normaliseObject(t)) }
  })
  return {
    corpora: async () => [{ id: 'nz', version: 'BC14', build: '14.0.47540', localisation: 'NZ', versionTag: 'NAVAPAC14', status: 'ready' }],
    baseLite: async () => lite,
    basePartHashes: async (ids) => {
      calls.parts.push(ids)
      return new Map(ids.map(id => [id, partHashes(BASE_TEXTS[parseInt(id.slice(1), 10)])]))
    },
  }
}

test('processExportText: deltas, only changed files, part hashes fetched only for mismatches', async () => {
  const customer =
    OBJ('Codeunit', 80, 'Sales-Post', ' Loyalty;', 'NAVW114.27,NAVAPAC14.27,CUST1') +   // modified
    OBJ('Codeunit', 90, 'Purch.-Post').replace('Date=01-01-26', 'Date=09-09-26') +       // re-stamped only
    BASE_TEXTS[2] +                                                                       // identical
    OBJ('Codeunit', 50010, 'Loyalty Mgt.', '', 'CUST1')                                   // new

  const gz = gzipSync(Buffer.from(customer, 'latin1'))
  const calls = { parts: [] as string[][] }
  const r = await processExportText(decodeExport(gz), fakeIO(calls), DEFAULT_CUSTOM_RANGES)

  assert.equal(r.match.corpus?.id, 'nz')
  assert.equal(r.match.confidence, 'high')
  assert.deepEqual(r.summary.byOrigin, { standard_unmodified: 2, standard_modified: 1, custom_new: 1, isv_or_unknown: 0 })
  assert.deepEqual(calls.parts, [['b0']], 'only CU80 needed its base part hashes')
  assert.deepEqual(r.files.map(f => f.path).sort(), [FULL_EXPORT_PREFIX + 'COD50010.TXT', FULL_EXPORT_PREFIX + 'COD80.TXT'])
  const cu80 = r.deltas.find(d => d.objectId === 80)!
  assert.deepEqual(cu80.modTags, ['CUST1'])
  assert.deepEqual(cu80.findings.map(f => f.code), ['object_trigger_code'])
})

test('processExportText refuses when no corpus matches', async () => {
  const io = fakeIO({ parts: [] })
  io.corpora = async () => []
  await assert.rejects(processExportText(BASE_TEXTS[0], io, DEFAULT_CUSTOM_RANGES), /No base corpus matches/)
})

test('decodeExport keeps OEM bytes byte-for-byte', () => {
  const raw = Buffer.concat([Buffer.from('OBJECT Codeunit 1 X\r\n', 'latin1'), Buffer.from([0x81, 0x94, 0xe1])])
  assert.equal(Buffer.from(decodeExport(gzipSync(raw)), 'latin1').equals(raw), true)
})

test('duplicate objects in an export are rejected', () => {
  assert.throws(() => tenantObjectsFromText(BASE_TEXTS[0] + BASE_TEXTS[0]), /twice/)
})

test('tenantCustomRanges validates stored JSON', () => {
  assert.deepEqual(tenantCustomRanges(null, DEFAULT_CUSTOM_RANGES), DEFAULT_CUSTOM_RANGES)
  assert.deepEqual(tenantCustomRanges([{ from: 50000, to: 99999 }, { from: 'x', to: 2 }], DEFAULT_CUSTOM_RANGES), [{ from: 50000, to: 99999 }])
  assert.deepEqual(tenantCustomRanges([{ from: 9, to: 1 }], DEFAULT_CUSTOM_RANGES), DEFAULT_CUSTOM_RANGES)
})
