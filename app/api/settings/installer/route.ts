import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { createTunnel, configureTunnelIngress, createDnsRecord, getTunnelToken } from '@/lib/cloudflare'
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
  const { bcUsername, bcPassword, bcPort = 8048, agentPort = 9099, bcInstance, bcCompany,
          navDatabaseServer = 'localhost', navDatabaseName = '', navServerInstance = '',
          testNavDatabaseServer = '', testNavDatabaseName = '', testNavServerInstance = '',
          testBcInstance = '', testBcCompany = '', testBcPort = 0, testNavManagementPort = 7045 } = body
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
  let tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  // ── Auto-provision tunnel on first installer download ─────────────────────
  // This is the activation event — no separate admin step required.
  if (!tenant.tunnelId) {
    if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_ZONE_ID) {
      return NextResponse.json({ error: 'Cloudflare environment variables not configured — contact support@bespoxai.com' }, { status: 500 })
    }
    // Derive subdomain from existing value or generate from tenant name
    const subdomain = (tenant.tunnelSubdomain || tenant.name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20))
    const hostname   = subdomain + '-agent.bespoxai.com'
    const tunnelName = 'bespoxai-' + subdomain
    try {
      const newTunnel = await createTunnel(tunnelName)
      await configureTunnelIngress(newTunnel.id, hostname, 'http://localhost:' + agentPort)
      await createDnsRecord(hostname, newTunnel.id)
      tenant = await (prisma as any).tenant.update({
        where: { id: tenantId },
        data:  { tunnelId: newTunnel.id, tunnelSubdomain: subdomain },
      })
    } catch (e: any) {
      return NextResponse.json({ error: 'Could not create Cloudflare tunnel: ' + e.message }, { status: 502 })
    }
  }
  // ── End auto-provision ────────────────────────────────────────────────────

  // Persist BC config from the form
  await (prisma as any).tenant.update({
    where: { id: tenantId },
    data: {
      ...(bcInstance  ? { bcInstance  } : {}),
      ...(bcUsername  ? { bcUsername  } : {}),
      ...(bcCompany  ? { bcCompany  } : {}),
      bcPort:            parseInt(String(bcPort),    10) || 8048,
      agentPort:         parseInt(String(agentPort), 10) || 9099,
      ...(navDatabaseName   ? { navDatabaseName }   : {}),
      ...(navServerInstance ? { navServerInstance } : {}),
      navDatabaseServer: navDatabaseServer || 'localhost',
      ...(testNavDatabaseServer ? { testNavDatabaseServer } : {}),
      ...(testNavDatabaseName   ? { testNavDatabaseName }   : {}),
      ...(testNavServerInstance ? { testNavServerInstance } : {}),
      ...(testBcInstance        ? { testBcInstance }        : {}),
      ...(testBcCompany         ? { testBcCompany }         : {}),
      ...(testBcPort            ? { testBcPort: parseInt(String(testBcPort), 10) || null } : {}),
      ...(testNavManagementPort ? { testNavManagementPort: parseInt(String(testNavManagementPort), 10) || 7045 } : {}),
    },
  })
  // Re-fetch to get latest tunnelId after possible update above
  const freshTenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
  if (!freshTenant) return NextResponse.json({ error: 'Tenant not found after provisioning' }, { status: 404 })
  tenant = freshTenant

  let tunnelToken: string
  try {
    tunnelToken = await getTunnelToken(tenant.tunnelId!)
  } catch (e: any) {
    return NextResponse.json({ error: 'Could not fetch tunnel token: ' + e.message }, { status: 502 })
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
    .replace('[int]    $BCPort      = 8048,',                 `[int]    $BCPort      = ${tenant.bcPort || 8048},`)
    .replace("[string] $BCInstance  = 'BC',",                 `[string] $BCInstance  = '${tenant.bcInstance || ''}',`)
    .replace("[string] $BCCompany   = 'CRONUS International Ltd.',", `[string] $BCCompany   = '${tenant.bcCompany || ''}',`)
    .replace('[int]    $AgentPort   = 9099,',                 `[int]    $AgentPort   = ${tenant.agentPort || 9099},`)
    .replace("[string] $NavDatabaseServer = 'localhost',",    `[string] $NavDatabaseServer = '${tenant.navDatabaseServer || 'localhost'}',`)
    .replace("[string] $NavDatabaseName   = '',",             `[string] $NavDatabaseName   = '${tenant.navDatabaseName || ''}',`)
    .replace("[string] $NavServerInstance    = '',",          `[string] $NavServerInstance    = '${tenant.navServerInstance || ''}',`)
    .replace("[string] $TestNavDatabaseServer = '',",         `[string] $TestNavDatabaseServer = '${tenant.testNavDatabaseServer || ''}',`)
    .replace("[string] $TestNavDatabaseName   = '',",         `[string] $TestNavDatabaseName   = '${tenant.testNavDatabaseName || ''}',`)
    .replace("[string] $TestNavServerInstance = '',",         `[string] $TestNavServerInstance = '${tenant.testNavServerInstance || ''}',`)
    .replace("[string] $TestBcInstance        = '',",         `[string] $TestBcInstance        = '${tenant.testBcInstance || ''}',`)
    .replace("[string] $TestBcCompany         = '',",         `[string] $TestBcCompany         = '${tenant.testBcCompany || ''}',`)
    .replace('[int]    $TestNavManagementPort  = 7045',       `[int]    $TestNavManagementPort  = ${(tenant as any).testNavManagementPort || 7045}`)

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
