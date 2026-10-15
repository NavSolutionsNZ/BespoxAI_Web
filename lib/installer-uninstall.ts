// lib/installer-uninstall.ts — ship the uninstaller in every installer zip.
//
// The zip gets Uninstall-BespoxAI.bat + Uninstall-BespoxAI.ps1 next to the
// installer, with the brand and agent port pre-set so a white-label or
// custom-port install is removed without anyone knowing the parameters. The
// installer .bat also copies them to C:\<Brand>\ after a successful install
// (see uninstallerCopyLines), so they're on the server when they're needed.

import { readFileSync } from 'fs'
import { join } from 'path'
import type JSZip from 'jszip'
import { psq, batText } from '@/lib/installer-escape'

const PS1_BRAND = "[string] $BrandName      = 'BespoxAI',"
const PS1_PORT  = '[int]    $AgentPort      = 9099,'

export function addUninstaller(zip: JSZip, opts: { brandName: string; agentPort: number }): void {
  // Literal paths, like the installer routes use for Install-BespoxAI.ps1, so
  // Next's file tracing bundles these files into the serverless function.
  let ps1 = readFileSync(join(process.cwd(), 'scripts', 'Uninstall-BespoxAI.ps1'), 'utf-8')
  const bat = readFileSync(join(process.cwd(), 'scripts', 'Uninstall-BespoxAI.bat'), 'utf-8')
  if (!ps1.includes(PS1_BRAND) || !ps1.includes(PS1_PORT)) throw new Error('Uninstaller parameter defaults not found')
  const port = Number.isInteger(opts.agentPort) && opts.agentPort > 0 && opts.agentPort < 65536 ? opts.agentPort : 9099
  ps1 = ps1
    .replace(PS1_BRAND, `[string] $BrandName      = '${psq(opts.brandName)}',`)
    .replace(PS1_PORT,  `[int]    $AgentPort      = ${port},`)
  zip.file('Uninstall-BespoxAI.ps1', ps1)
  zip.file('Uninstall-BespoxAI.bat', bat)
}

/**
 * .bat lines for the installer wrapper: after a successful install, copy the
 * uninstaller from the extracted zip folder into C:\<Brand>\. Uses !_exit!
 * (delayed expansion is on in the wrapper).
 */
export function uninstallerCopyLines(brandName: string): string {
  const root = 'C:\\' + batText(brandName) + '\\'
  return [
    'if "!_exit!"=="0" if exist "%~dp0Uninstall-BespoxAI.ps1" (',
    `    copy /Y "%~dp0Uninstall-BespoxAI.ps1" "${root}" >nul`,
    `    copy /Y "%~dp0Uninstall-BespoxAI.bat" "${root}" >nul`,
    `    echo  Uninstaller saved to ${root}Uninstall-BespoxAI.bat`,
    ')',
  ].join('\n')
}
