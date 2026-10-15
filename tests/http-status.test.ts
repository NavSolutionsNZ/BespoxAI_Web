/**
 * tests/http-status.test.ts
 *
 * bespoxai.com is behind Cloudflare, which replaces any 502/504 from the origin
 * with its own HTML page, so our JSON error never reaches the browser. API
 * routes answer upstream failures with UPSTREAM_FAILED (424) instead.
 *
 * Run: npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { UPSTREAM_FAILED } from '../lib/http-status'

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

test('UPSTREAM_FAILED is not a status Cloudflare intercepts', () => {
  assert.ok(![502, 504].includes(UPSTREAM_FAILED))
})

test('no route or helper answers 502/504', () => {
  const root = join(__dirname, '..')
  const offenders: string[] = []
  for (const f of [...walk(join(root, 'app')), ...walk(join(root, 'lib'))]) {
    const src = readFileSync(f, 'utf8')
    if (/status:\s*50[24]\b|RdpError\(\s*50[24]\b|status\(\s*50[24]\s*\)/.test(src)) offenders.push(f.slice(root.length + 1))
  }
  assert.deepEqual(offenders, [], 'use UPSTREAM_FAILED from lib/http-status instead')
})
