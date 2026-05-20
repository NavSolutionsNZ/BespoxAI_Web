import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getTunnelToken } from '@/lib/cloudflare'
import { readFileSync } from 'fs'
import { join } from 'path'
import JSZip from 'jszip'

export const dynamic = 'force-dynamic'

function isTenantAdmin(role: string) { return role === 'tenant_admin' || role === 'superadmin' }

// ── DEBUG MODE ────────────────────────────────────────────────────────────────
const DEBUG = process.env.SETTINGS_DEBUG === 'true'
// ── END DEBUG ─────────────────────────────────────────────────────────────────

// POST /api/settings/installer — generate pre-configured BCAgent installer for this tenant
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const role = (session?.user as any)?.role
  if (!session?.user || !isTenantAdmin(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { bcUsername, bcPassword, bcPort = 8048, agentPort = 8080, bcInstance, bcCompany } = body
  if (!bcUsername) return NextResponse.json({ error: 'BC username is required' }, { status: 400 })

  // ── DEBUG ── Generates a clearly-marked dummy installer zip
  if (DEBUG) {
    const debugPs1 = `# ============================================================
# BespoxAI BCAgent Installer — DEBUG MODE PREVIEW
# This is NOT a real installer. Set SETTINGS_DEBUG=false to
# generate a real installer with live credentials.
# ============================================================
#
# Would be configured with:
#   BC Username : ${bcUsername}
#   BC Instance : ${bcInstance || '(from tenant)'}
#   BC Company  : ${bcCompany || '(from tenant)'}
#   BC Port     : ${bcPort}
#   Agent Port  : ${agentPort}
#   Tunnel Token: [fetched from Cloudflare at generation time]
#   API Key     : [from tenant record]
#
Write-Host "DEBUG INSTALLER — not real" -ForegroundColor Yellow
`
    const zip = new JSZip()
    zip.file('Install-BespoxAI-DEBUG.ps1', debugPs1)
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    return new NextResponse(buf as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="Install-BespoxAI-DEBUG.zip"',
      },
    })
  }
  // ── END DEBUG ──

  const tenantId = (session.user as any).tenantId
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  if (!tenant.tunnelId) return NextResponse.json({
    error: 'No tunnel configured for this tenant. Contact support@bespoxai.com to provision a tunnel.',
  }, { status: 400 })

  // Persist any updated bcInstance/bcCompany from the form
  if (bcInstance || bcCompany) {
    await (prisma as any).tenant.update({
      where: { id: tenantId },
      data: {
        ...(bcInstance ? { bcInstance } : {}),
        ...(bcCompany  ? { bcCompany  } : {}),
        bcPort:    parseInt(String(bcPort),    10) || 8048,
        agentPort: parseInt(String(agentPort), 10) || 8080,
      },
    })
  }

  let tunnelToken: string
  try {
    tunnelToken = await getTunnelToken(tenant.tunnelId)
  } catch (e: any) {
    return NextResponse.json({ error: `Could not fetch tunnel token: ${e.message}` }, { status: 502 })
  }

  const scriptPath = join(process.cwd(), 'scripts', 'Install-BespoxAI.ps1')
  let script: string
  try { script = readFileSync(scriptPath, 'utf-8') }
  catch { return NextResponse.json({ error: 'Installer template not found' }, { status: 500 }) }

  const configured = script
    .replace('[Parameter(Mandatory)][string]  $TunnelToken,', `[string] $TunnelToken = '${tunnelToken}',`)
    .replace('[Parameter(Mandatory)][string]  $ApiKey,',      `[string] $ApiKey = '${tenant.apiKey}',`)
    .replace('[Parameter(Mandatory)][string]  $BCUsername,',  `[string] $BCUsername = '${bcUsername}',`)
    .replace('[Parameter(Mandatory)][string]  $BCPassword,',  `[string] $BCPassword = '${bcPassword ?? ''}',`)
    .replace('[int]    $BCPort      = 8048,',                 `[int]    $BCPort      = ${bcPort},`)
    .replace("[string] $BCInstance  = 'BC',",                 `[string] $BCInstance  = '${bcInstance || tenant.bcInstance}',`)
    .replace("[string] $BCCompany   = 'CRONUS International Ltd.',", `[string] $BCCompany   = '${bcCompany || tenant.bcCompany}',`)
    .replace('[int]    $AgentPort   = 8080,',                 `[int]    $AgentPort   = ${agentPort},`)

  // Base64 + BAT wrapper (same pattern as admin installer)
  const b64 = Buffer.from(configured, 'utf-8').toString('base64')
  const chunks: string[] = []
  for (let i = 0; i < b64.length; i += 4000) chunks.push(b64.slice(i, i + 4000))
  const tenantSlug = tenant.tunnelSubdomain.replace(/[^a-z0-9]/gi, '')

  const bat = `@echo off
setlocal EnableDelayedExpansion
title BespoxAI Installer ^| ${tenant.name}
color 0A
echo.
echo  ============================================================
echo    BespoxAI Agent Installer
echo    Tenant: ${tenant.name}
echo    BC:     ${bcInstance || tenant.bcInstance} / ${bcCompany || tenant.bcCompany}
echo  ============================================================
echo.
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo  Requesting Administrator privileges...
    powershell -NoProfile -Command "Start-Process -FilePath '%%~f0' -Verb RunAs"
    exit /b
)
set "_tmp=%TEMP%\\bespoxai_%RANDOM%.b64"
set "_ps1=%TEMP%\\bespoxai_%RANDOM%.ps1"
(
${chunks.map(c => `echo ${c}`).join('\n')}
) > "!_tmp!"
powershell -NoProfile -Command "$b=(Get-Content '!_tmp!')-join'';$s=[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b));[System.IO.File]::WriteAllText('!_ps1!',$s,[System.Text.Encoding]::UTF8);Remove-Item '!_tmp!'"
powershell -NoProfile -ExecutionPolicy Bypass -File "!_ps1!"
set "_exit=%errorlevel%"
powershell -NoProfile -Command "Remove-Item '!_ps1!' -ErrorAction SilentlyContinue"
echo.
pause
exit /b %_exit%
`

  const zip = new JSZip()
  zip.file(`Install-BespoxAI-${tenantSlug}.bat`, bat)
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

  return new NextResponse(zipBuffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="Install-BespoxAI-${tenantSlug}.zip"`,
    },
  })
}
