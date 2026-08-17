import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { createTunnel, configureTunnelIngress, createDnsRecord, getTunnelToken } from '@/lib/cloudflare'
import { readFileSync } from 'fs'
import { join } from 'path'
import JSZip from 'jszip'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

function isTenantAdmin(role: string) { return role === 'tenant_admin' || role === 'superadmin' }

// ── DEBUG MODE ────────────────────────────────────────────────────────────────
const DEBUG = process.env.SETTINGS_DEBUG === 'true'
// ── END DEBUG ─────────────────────────────────────────────────────────────────

const AGENT_VERSION = '3.5'

function generateRdpPassword(): string {
  const upper   = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower   = 'abcdefghjkmnpqrstuvwxyz'
  const digits  = '23456789'
  const symbols = '!@#$'
  const all     = upper + lower + digits + symbols
  const bytes   = crypto.randomBytes(12)
  // Guarantee complexity: 1 upper, 1 lower, 1 digit, 1 symbol + 8 random
  const pwd = [
    upper[bytes[0]  % upper.length],
    lower[bytes[1]  % lower.length],
    digits[bytes[2] % digits.length],
    symbols[bytes[3] % symbols.length],
    ...Array.from(bytes.slice(4)).map(b => all[b % all.length]),
  ]
  // Fisher-Yates shuffle
  for (let i = pwd.length - 1; i > 0; i--) {
    const j = crypto.randomBytes(1)[0] % (i + 1);
    [pwd[i], pwd[j]] = [pwd[j], pwd[i]]
  }
  return pwd.join('')
}

// POST /api/settings/installer — generate pre-configured BCAgent installer for this tenant
export async function GET() {
  return NextResponse.json({ version: AGENT_VERSION })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const role = (session?.user as any)?.role
  if (!session?.user || !isTenantAdmin(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // ── Agent is a paid-tier feature — free tier cannot generate the installer ──
  {
    const { checkFeatureAccess } = await import('@/lib/tier')
    const allowed = await checkFeatureAccess((session.user as any).tenantId, 'agent')
    if (!allowed) {
      return NextResponse.json(
        { error: 'The BespoxAI Agent is available on paid plans. Upgrade to Starter ($59/mo) to connect your environment and ground every feasibility check in your actual objects and customisations.' },
        { status: 403 }
      )
    }
  }

  const body = await req.json().catch(() => ({}))
  const { bcUsername, bcPassword, bcPort, agentPort, bcInstance, bcCompany,
          bcAuthMode = 'Windows', serviceAccountUser, serviceAccountPassword,
          navDatabaseServer, navDatabaseName, navServerInstance,
          testNavDatabaseServer = '', testNavDatabaseName = '', testNavServerInstance = '',
          testBcInstance = '', testBcCompany = '', testBcPort = 0, testNavManagementPort = 7045 } = body
  if (!bcUsername) return NextResponse.json({ error: 'BC username is required' }, { status: 400 })
  // Basic mode needs a real Windows account to run the scheduled task under,
  // since bcUsername is a BC application user in that mode, not a Windows
  // identity — same requirement the installer script itself enforces.
  if (bcAuthMode === 'Basic' && (!serviceAccountUser || !serviceAccountPassword)) {
    return NextResponse.json({ error: 'Basic auth mode requires a Service Account username and password (the Windows account that will run the agent).' }, { status: 400 })
  }

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
  let tenant = await (prisma as any).tenant.findUnique({
    where: { id: tenantId },
    include: { partnerAccount: { select: { isWhiteLabel: true, agentBrandName: true } } },
  })
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
    const ingressAgentPort = agentPort ?? tenant.agentPort ?? 9099
    try {
      const newTunnel = await createTunnel(tunnelName)
      await configureTunnelIngress(newTunnel.id, hostname, 'http://localhost:' + ingressAgentPort)
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

  // Persist production BC config from the installer form only — only touch fields
  // the request actually provided, so an incomplete/stale request body can't
  // clobber previously-saved values (e.g. from onboarding) back to generic defaults.
  await (prisma as any).tenant.update({
    where: { id: tenantId },
    data: {
      ...(bcInstance        ? { bcInstance }        : {}),
      ...(bcUsername        ? { bcUsername }         : {}),
      ...(bcCompany         ? { bcCompany }          : {}),
      ...(bcAuthMode        ? { bcAuthMode }          : {}),
      // serviceAccountPassword is deliberately NOT persisted here — same rule
      // as bcPassword: never stored, only ever embedded into a downloaded
      // installer. serviceAccountUser is a real (non-secret) column so it
      // pre-fills on the next installer download, same as bcUsername.
      ...(serviceAccountUser ? { serviceAccountUser } : {}),
      ...(bcPort            !== undefined ? { bcPort:    parseInt(String(bcPort),    10) || 7048 } : {}),
      ...(agentPort         !== undefined ? { agentPort: parseInt(String(agentPort), 10) || 9099 } : {}),
      ...(navDatabaseName   ? { navDatabaseName }   : {}),
      ...(navServerInstance ? { navServerInstance } : {}),
      ...(navDatabaseServer ? { navDatabaseServer } : {}),
    },
  })
  // Re-fetch to get latest tunnelId after possible update above
  const freshTenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
  if (!freshTenant) return NextResponse.json({ error: 'Tenant not found after provisioning' }, { status: 404 })
  tenant = freshTenant

  // Generate RDP support account password if not already set — stored so admin can retrieve it
  let rdpPassword = (tenant as any).rdpPassword as string | null
  if (!rdpPassword) {
    rdpPassword = generateRdpPassword()
    await prisma.tenant.update({ where: { id: tenantId }, data: { rdpPassword } as any })
  }

  let tunnelToken: string
  try {
    tunnelToken = await getTunnelToken(tenant.tunnelId!)
  } catch (e: any) {
    return NextResponse.json({ error: 'Could not fetch tunnel token: ' + e.message }, { status: 502 })
  }

  const partnerBranding = (tenant as any).partnerAccount
  const agentBrandName = (partnerBranding?.isWhiteLabel && partnerBranding?.agentBrandName)
    ? partnerBranding.agentBrandName
    : 'BespoxAI'

  const scriptPath = join(process.cwd(), 'scripts', 'Install-BespoxAI.ps1')
  let script: string
  try { script = readFileSync(scriptPath, 'utf-8') }
  catch { return NextResponse.json({ error: 'Installer template not found' }, { status: 500 }) }

  const configured = script
    .replace('[Parameter(Mandatory)][string]  $TunnelToken,', `[string] $TunnelToken = '${tunnelToken}',`)
    .replace('[Parameter(Mandatory)][string]  $ApiKey,',      `[string] $ApiKey = '${tenant.apiKey}',`)
    .replace('[Parameter(Mandatory)][string]  $BCUsername,',  `[string] $BCUsername = '${bcUsername}',`)
    .replace('[Parameter(Mandatory)][string]  $BCPassword,',  `[string] $BCPassword = '${bcPassword ?? ''}',`)
    .replace("[ValidateSet('Windows','Basic')][string] $BCAuthMode = 'Windows',", `[ValidateSet('Windows','Basic')][string] $BCAuthMode = '${bcAuthMode === 'Basic' ? 'Basic' : 'Windows'}',`)
    .replace("[string] $ServiceAccount         = '',",        `[string] $ServiceAccount         = '${serviceAccountUser ?? ''}',`)
    .replace("[string] $ServiceAccountPassword = '',",        `[string] $ServiceAccountPassword = '${serviceAccountPassword ?? ''}',`)
    .replace('[int]    $BCPort      = 7048,',                 `[int]    $BCPort      = ${tenant.bcPort || 7048},`)
    .replace("[string] $BCInstance  = 'BC',",                 `[string] $BCInstance  = '${tenant.bcInstance || ''}',`)
    .replace("[string] $BCCompany   = 'CRONUS International Ltd.',", `[string] $BCCompany   = '${tenant.bcCompany || ''}',`)
    .replace('[int]    $AgentPort   = 9099,',                 `[int]    $AgentPort   = ${tenant.agentPort || 9099},`)
    .replace("[string] $NavDatabaseServer = 'localhost',",    `[string] $NavDatabaseServer = '${tenant.navDatabaseServer || 'localhost'}',`)
    .replace("[string] $NavDatabaseName   = '',",             `[string] $NavDatabaseName   = '${tenant.navDatabaseName || ''}',`)
    .replace("[string] $NavServerInstance    = '',",          `[string] $NavServerInstance    = '${tenant.navServerInstance || ''}',`)
    .replace('[int]    $NavManagementPort    = 7045,',        `[int]    $NavManagementPort    = ${(tenant as any).navManagementPort || 7045},`)
    .replace("[string] $TestNavDatabaseServer = '',",         `[string] $TestNavDatabaseServer = '${tenant.testNavDatabaseServer || ''}',`)
    .replace("[string] $TestNavDatabaseName   = '',",         `[string] $TestNavDatabaseName   = '${tenant.testNavDatabaseName || ''}',`)
    .replace("[string] $TestNavServerInstance = '',",         `[string] $TestNavServerInstance = '${tenant.testNavServerInstance || ''}',`)
    .replace("[string] $TestBcInstance        = '',",         `[string] $TestBcInstance        = '${tenant.testBcInstance || ''}',`)
    .replace("[string] $TestBcCompany         = '',",         `[string] $TestBcCompany         = '${tenant.testBcCompany || ''}',`)
    .replace('[int]    $TestNavManagementPort  = 7045',       `[int]    $TestNavManagementPort  = ${(tenant as any).testNavManagementPort || 7045}`)
    .replace("[string] $SupportAccountPassword = \'\'"  ,         `[string] $SupportAccountPassword = '${rdpPassword}'`)
    .replace("[string] $BrandName = 'BespoxAI'",             `[string] $BrandName = '${agentBrandName}'`)

  // Base64 + BAT wrapper (same pattern as admin installer)
  const b64 = Buffer.from(configured, 'utf-8').toString('base64')
  const chunks: string[] = []
  for (let i = 0; i < b64.length; i += 4000) chunks.push(b64.slice(i, i + 4000))
  const tenantSlug = tenant.tunnelSubdomain.replace(/[^a-z0-9]/gi, '')

  const bat = `@echo off
setlocal EnableDelayedExpansion
title ${agentBrandName} Installer ^| ${tenant.name}
color 0A
echo.
echo  ============================================================
echo    ${agentBrandName} Agent Installer
echo    Tenant: ${tenant.name}
echo    BC:     ${bcInstance || tenant.bcInstance || '(not set)'} / ${bcCompany || tenant.bcCompany || '(not set)'}
echo    Auth:   ${bcAuthMode === 'Basic' ? 'Basic (NavUserPassword)' : 'Windows (NTLM)'}
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
  zip.file(`Install-BespoxAI-v${AGENT_VERSION}-${tenantSlug}.bat`, bat)
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

  return new NextResponse(zipBuffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="Install-BespoxAI-v${AGENT_VERSION}-${tenantSlug}.zip"`,
    },
  })
}
