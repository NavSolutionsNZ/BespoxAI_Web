/**
 * tests/installer-uninstall.test.ts
 *
 * The uninstaller ships in every installer zip, with the brand and agent port
 * pre-set, and the installer .bat copies it to C:\<Brand>\ after a successful
 * install.
 *
 * Run: npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { addUninstaller, uninstallerCopyLines } from '../lib/installer-uninstall'

test('zip gets the uninstaller with brand and port pre-set', async () => {
  const zip = new JSZip()
  addUninstaller(zip, { brandName: "O'Brien Ltd", agentPort: 9100 })
  const ps1 = await zip.file('Uninstall-BespoxAI.ps1')!.async('string')
  const bat = await zip.file('Uninstall-BespoxAI.bat')!.async('string')
  assert.match(ps1, /\[string\] \$BrandName\s+= 'O''Brien Ltd',/)      // quote escaped for PowerShell
  assert.match(ps1, /\[int\]\s+\$AgentPort\s+= 9100,/)
  assert.match(ps1, /BespoxAI_\*/)                                       // removes the web services
  assert.match(bat, /Uninstall-BespoxAI\.ps1/)
})

test('an invalid port falls back to 9099', async () => {
  const zip = new JSZip()
  addUninstaller(zip, { brandName: 'BespoxAI', agentPort: 0 })
  const ps1 = await zip.file('Uninstall-BespoxAI.ps1')!.async('string')
  assert.match(ps1, /\[int\]\s+\$AgentPort\s+= 9099,/)
})

test('copy lines run only after a successful install, into C:\\<Brand>\\', () => {
  const lines = uninstallerCopyLines('Endeavour')
  assert.match(lines, /^if "!_exit!"=="0" if exist "%~dp0Uninstall-BespoxAI\.ps1" \(/)
  assert.match(lines, /copy \/Y "%~dp0Uninstall-BespoxAI\.bat" "C:\\Endeavour\\" >nul/)
  assert.doesNotMatch(uninstallerCopyLines('A&B | C'), /[&|]/)           // cmd metacharacters neutralised
})
