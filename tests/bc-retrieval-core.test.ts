/**
 * tests/bc-retrieval-core.test.ts
 *
 * Unit tests for the pure logic behind the index tools:
 * customisation detection, where-used reference matching, and
 * latest-version dedupe. No database required.
 *
 * Run: npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  summaryHasCustomisation,
  referencesTarget,
  dedupeLatest,
} from '../lib/bc-retrieval-core'

// ── summaryHasCustomisation ───────────────────────────────────────────────────

test('detects customisation via modTags', () => {
  assert.ok(summaryHasCustomisation({ modTags: ['AP2378'] }))
})

test('detects customisation via customFields', () => {
  assert.ok(summaryHasCustomisation({ customFields: [{ id: 50000, name: 'X', type: 'Boolean' }] }))
})

test('no customisation on plain summaries', () => {
  assert.ok(!summaryHasCustomisation({ fields: [{ id: 1, name: 'No.', type: 'Code20' }] }))
  assert.ok(!summaryHasCustomisation(null))
  assert.ok(!summaryHasCustomisation({}))
})

test('tag filter matches case- and space-insensitively, and only that tag', () => {
  const s = { modTags: ['AP2378', 'AP2267'] }
  assert.ok(summaryHasCustomisation(s, 'ap2378'))
  assert.ok(summaryHasCustomisation(s, 'AP 2267'))
  assert.ok(!summaryHasCustomisation(s, 'AP9999'))
  // Tag filter must not fall back to customFields
  assert.ok(!summaryHasCustomisation({ customFields: [{ id: 50000 }] }, 'AP2378'))
})

// ── referencesTarget ──────────────────────────────────────────────────────────

test('matches numeric references by type + id', () => {
  const refs = [{ objectType: 'Table', objectId: 36 }, { objectType: 'Codeunit', objectId: 80 }]
  assert.ok(referencesTarget(refs, { objectType: 'Table', objectId: 36 }))
  assert.ok(!referencesTarget(refs, { objectType: 'Table', objectId: 37 }))
  assert.ok(!referencesTarget(refs, { objectType: 'Page', objectId: 36 }), 'type must match')
})

test('Record references match Table targets (normalisation)', () => {
  const refs = [{ objectType: 'Record', objectId: 36 }]
  assert.ok(referencesTarget(refs as any, { objectType: 'Table', objectId: 36 }))
})

test('matches name-based references case-insensitively', () => {
  const refs = [{ objectType: 'Table', name: 'Sales Header' }]
  assert.ok(referencesTarget(refs, { objectType: 'Table', objectName: 'sales header' }))
  assert.ok(!referencesTarget(refs, { objectType: 'Table', objectName: 'Sales Line' }))
})

test('numeric target with only name refs falls through to name matching', () => {
  const refs = [{ objectType: 'Table', name: 'Sales Header' }]
  // Target has id AND resolved name (whereUsed resolves names from the index)
  assert.ok(referencesTarget(refs, { objectType: 'Table', objectId: 36, objectName: 'Sales Header' }))
})

test('empty or missing refs never match', () => {
  assert.ok(!referencesTarget(undefined, { objectType: 'Table', objectId: 36 }))
  assert.ok(!referencesTarget([], { objectType: 'Table', objectId: 36 }))
})

// ── dedupeLatest ──────────────────────────────────────────────────────────────

test('keeps only the most recent version of each object', () => {
  const older = new Date('2026-01-01')
  const newer = new Date('2026-08-01')
  const rows = [
    { objectType: 'Codeunit', objectId: 50009, objectName: 'JET TO ESKER XFR', uploadedAt: older, v: 'old' },
    { objectType: 'Codeunit', objectId: 50009, objectName: 'JET TO ESKER XFR', uploadedAt: newer, v: 'new' },
    { objectType: 'Table',    objectId: 36,    objectName: 'Sales Header',     uploadedAt: older, v: 'only' },
  ]
  const out = dedupeLatest(rows as any) as any[]
  assert.equal(out.length, 2)
  assert.equal(out.find(r => r.objectId === 50009)?.v, 'new')
})

test('objects without ids dedupe by name, case-insensitively', () => {
  const rows = [
    { objectType: 'Query', objectId: null, objectName: 'Top Customers', uploadedAt: new Date('2026-01-01') },
    { objectType: 'Query', objectId: null, objectName: 'TOP CUSTOMERS', uploadedAt: new Date('2026-06-01') },
  ]
  const out = dedupeLatest(rows as any)
  assert.equal(out.length, 1)
})

test('same id across different types is not merged', () => {
  const now = new Date()
  const rows = [
    { objectType: 'Table', objectId: 116, objectName: 'Reminder Header', uploadedAt: now },
    { objectType: 'Report', objectId: 116, objectName: 'Statement',      uploadedAt: now },
  ]
  assert.equal(dedupeLatest(rows as any).length, 2)
})
