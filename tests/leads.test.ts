/**
 * tests/leads.test.ts
 *
 * Validation for the marketing-site intake form (/api/leads), and a check
 * that the browser form (public/lead-form.js) offers the same options the
 * server accepts.
 *
 * Run: npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  LEAD_CHALLENGES, LEAD_EMAIL_MESSAGE, LEAD_VERSIONS,
  isHoneypotTripped, validateLead,
} from '../lib/leads'

const good = { name: '  Jane Smith ', email: ' Jane@Acme.co.nz ', company: 'Acme', navVersion: 'NAV 2017', challenge: 'Finance reporting and month-end', source: 'nav-end-of-support' }

test('accepts a valid lead and normalises it', () => {
  const r = validateLead(good)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.lead.name, 'Jane Smith')
  assert.equal(r.lead.email, 'jane@acme.co.nz')
  assert.equal(r.lead.navVersion, 'NAV 2017')
  assert.equal(r.lead.source, 'nav-end-of-support')
  assert.equal(r.lead.message, null)
})

test('requires a name and a valid email', () => {
  assert.equal(validateLead({ ...good, name: '   ' }).ok, false)
  assert.equal(validateLead({ ...good, email: 'not-an-email' }).ok, false)
  assert.equal(validateLead({}).ok, false)
})

test('rejects free and disposable email providers', () => {
  const r = validateLead({ ...good, email: 'jane@gmail.com' })
  assert.deepEqual(r, { ok: false, error: LEAD_EMAIL_MESSAGE })
})

test('unknown option values are stored as Other, unknown source as homepage', () => {
  const r = validateLead({ ...good, navVersion: 'NAV 3000', challenge: '<script>', source: 'evil' })
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.lead.navVersion, 'Other')
  assert.equal(r.lead.challenge, 'Other')
  assert.equal(r.lead.source, 'homepage')
})

test('long text is truncated, non-strings ignored', () => {
  const r = validateLead({ ...good, message: 'x'.repeat(5000), company: { a: 1 } })
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.lead.message?.length, 2000)
  assert.equal(r.lead.company, null)
})

test('honeypot', () => {
  assert.equal(isHoneypotTripped({ website: 'http://spam' }), true)
  assert.equal(isHoneypotTripped({ website: '' }), false)
  assert.equal(isHoneypotTripped({}), false)
})

function jsArray(src: string, name: string): string[] {
  const m = src.match(new RegExp('var ' + name + ' = \\[([\\s\\S]*?)\\];'))
  assert.ok(m, name + ' not found in lead-form.js')
  return Array.from(m![1].matchAll(/'([^']*)'/g), (x) => x[1])
}

test('public/lead-form.js offers exactly the options the server accepts', () => {
  const src = readFileSync(join(__dirname, '..', 'public', 'lead-form.js'), 'utf8')
  assert.deepEqual(jsArray(src, 'VERSIONS'), [...LEAD_VERSIONS])
  assert.deepEqual(jsArray(src, 'CHALLENGES'), [...LEAD_CHALLENGES])
})
