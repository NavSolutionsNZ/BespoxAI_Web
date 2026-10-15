/**
 * tests/agent-forwarding.test.ts
 *
 * BCAgent 3.14: where the agent forwards a proxied OData request. bcBaseUrl
 * carries the instance (http://localhost:7048/BC140) and the portal sends
 * /BC140/ODataV4/..., which before 3.14 became /BC140/BC140/ODataV4 (HTTP.sys
 * 503). Runs the real Get-BcTargetUrl from the installer through PowerShell;
 * skipped where pwsh isn't installed.
 *
 * Run: npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const PS1 = readFileSync(join(__dirname, '..', 'scripts', 'Install-BespoxAI.ps1'), 'utf8')
const PWSH = process.env.PWSH || 'pwsh'
const hasPwsh = spawnSync(PWSH, ['-NoProfile', '-Command', 'exit 0']).status === 0

const CASES: [string, string, string][] = [
  ['http://localhost:7048/BC140',  '/BC140/ODataV4/$metadata',              'http://localhost:7048/BC140/ODataV4/$metadata'],
  ['http://localhost:7048/BC140/', "/BC140/ODataV4/Company('X')/Customer?$top=1", "http://localhost:7048/BC140/ODataV4/Company('X')/Customer?$top=1"],
  ['http://localhost:7048',        '/BC140/ODataV4/$metadata',              'http://localhost:7048/BC140/ODataV4/$metadata'],
  ['http://bc22:7048/BC/OData',    '/BC/ODataV4/$metadata',                 'http://bc22:7048/BC/ODataV4/$metadata'],
  ['http://localhost:7048/BC140',  '/ODataV4/Company',                      'http://localhost:7048/BC140/ODataV4/Company'],
  ['http://localhost:7048/BC140',  '/BC140TEST/ODataV4/$metadata',          'http://localhost:7048/BC140TEST/ODataV4/$metadata'],
  ['http://localhost:7048/BC140',  '/BC140/api/v1.0/companies',             'http://localhost:7048/BC140/api/v1.0/companies'],
]

test('the agent forwards through Get-BcTargetUrl', () => {
  assert.match(PS1, /\$targetUrl = Get-BcTargetUrl \$BCBase \$rawUrl/)
  assert.doesNotMatch(PS1, /\$targetUrl = \$BCBase\.TrimEnd\('\/'\) \+ \$rawUrl/)
})

test('Get-BcTargetUrl never doubles the instance', { skip: hasPwsh ? false : 'pwsh not installed' }, () => {
  const fn = PS1.match(/function Get-BcTargetUrl \{[\s\S]*?\n\}/)?.[0]
  assert.ok(fn, 'Get-BcTargetUrl not found in the installer')
  const dir = mkdtempSync(join(tmpdir(), 'bcfwd-'))
  const script = join(dir, 't.ps1')
  const q = (s: string) => "'" + s.replace(/'/g, "''") + "'"
  writeFileSync(script, fn + '\n' + CASES.map(c => 'Get-BcTargetUrl ' + q(c[0]) + ' ' + q(c[1])).join('\n') + '\n')
  const r = spawnSync(PWSH, ['-NoProfile', '-File', script], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.stdout.trim().split(/\r?\n/), CASES.map(c => c[2]))
})
