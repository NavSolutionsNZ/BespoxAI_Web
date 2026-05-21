#Requires -RunAsAdministrator
#Requires -Version 5.1
<#
.SYNOPSIS
    BespoxAI Installer v1.0
    Sets up BCAgent (local OData proxy) and a Cloudflare tunnel so BespoxAI
    can query your Business Central data securely from bespoxai.com.

.DESCRIPTION
    This script:
      1. Creates C:\BespoxAI\ directory structure
      2. Downloads cloudflared.exe (Cloudflare Tunnel client)
      3. Installs BCAgent v2.3 (local NTLM proxy + NAV object export)
      4. Writes agent.config.json with your credentials
      5. Installs cloudflared as a Windows service (auto-start)
      6. Installs BCAgent as a scheduled task (auto-start, runs as SYSTEM)
      7. Starts both services and verifies connectivity

    Prerequisites:
      - Windows Server 2016+ or Windows 10+ (64-bit)
      - PowerShell 5.1+
      - Run as Administrator
      - Business Central OData web services enabled and accessible locally
      - A BespoxAI tenant created (get ApiKey and TunnelToken from admin@bespoxai.com)

.PARAMETER TunnelToken
    Cloudflare tunnel token provided by BespoxAI.
    Format: eyJhIjoiLi4uIn0... (long base64 string)

.PARAMETER ApiKey
    BespoxAI API key for this installation.
    Get this from the BespoxAI admin portal when creating your tenant.

.PARAMETER BCUsername
    Windows or domain account for BC NTLM authentication.
    Format: DOMAIN\username  or  .\localuser

.PARAMETER BCPassword
    Password for the BC account (will not be echoed or logged).

.PARAMETER BCPort
    BC OData port. Default: 8048

.PARAMETER BCInstance
    BC server instance name. Default: BC

.PARAMETER BCCompany
    BC company name as used in OData URL. Default: CRONUS International Ltd.

.PARAMETER AgentPort
    Local port for BCAgent to listen on. Default: 8080
    (Must match what BespoxAI expects — do not change unless instructed.)

.EXAMPLE
    .\Install-BespoxAI.ps1 `
        -TunnelToken "eyJhIjoiLi4uIn0..." `
        -ApiKey "Xh11SG474IAy/..." `
        -BCUsername "CONTOSO\svc_bespoxai" `
        -BCPassword "MyPassword123" `
        -BCInstance "BC_Prod" `
        -BCCompany "Contoso Ltd"
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]  $TunnelToken,
    [Parameter(Mandatory)][string]  $ApiKey,
    [Parameter(Mandatory)][string]  $BCUsername,
    [Parameter(Mandatory)][string]  $BCPassword,
    [int]    $BCPort      = 8048,
    [string] $BCInstance  = 'BC',
    [string] $BCCompany   = 'CRONUS International Ltd.',
    [int]    $AgentPort   = 8080,
    [string] $NavDatabaseServer = 'localhost',
    [string] $NavDatabaseName   = '',
    [string] $NavServerInstance = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Paths ──────────────────────────────────────────────────────────────────────

$InstallRoot   = 'C:\BespoxAI'
$AgentDir      = "$InstallRoot\Agent"
$CloudflaredDir= "$InstallRoot\Cloudflared"
$LogDir        = "$InstallRoot\Logs"
$AgentScript   = "$AgentDir\BCAgent.ps1"
$AgentConfig   = "$AgentDir\agent.config.json"
$CloudflaredExe= "$CloudflaredDir\cloudflared.exe"

$CloudflaredUrl = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'

# ── Helpers ────────────────────────────────────────────────────────────────────

function Write-Step  { param($msg) Write-Host "`n  → $msg" -ForegroundColor Cyan }
function Write-OK    { param($msg) Write-Host "    ✓ $msg" -ForegroundColor Green }
function Write-Fail  { param($msg) Write-Host "    ✗ $msg" -ForegroundColor Red; throw $msg }

function Test-Port {
    param([int]$Port)
    try {
        $tcp = [System.Net.Sockets.TcpClient]::new('localhost', $Port)
        $tcp.Close(); return $true
    } catch { return $false }
}

# ── Banner ─────────────────────────────────────────────────────────────────────

Write-Host ''
Write-Host '  ╔══════════════════════════════════════════════╗' -ForegroundColor DarkCyan
Write-Host '  ║        BespoxAI Installer  v1.0              ║' -ForegroundColor DarkCyan
Write-Host '  ║  Business Central → AI Query Layer           ║' -ForegroundColor DarkCyan
Write-Host '  ╚══════════════════════════════════════════════╝' -ForegroundColor DarkCyan
Write-Host ''
Write-Host "  BC Instance : $BCInstance"
Write-Host "  BC Company  : $BCCompany"
Write-Host "  BC Port     : $BCPort"
Write-Host "  Agent Port  : $AgentPort"
Write-Host "  BC User     : $BCUsername"
Write-Host ''

# ── Step 1: Prerequisites ──────────────────────────────────────────────────────

Write-Step 'Checking prerequisites'

# Port conflict check
if (Test-Port -Port $AgentPort) {
    Write-Host ''
    Write-Host "    ⚠ Port $AgentPort is already in use on this machine." -ForegroundColor Yellow
    Write-Host '      Another BCAgent or service may be running.' -ForegroundColor Yellow
    Write-Host "      Use -AgentPort to specify a different port (e.g. -AgentPort 8081)" -ForegroundColor Yellow
    Write-Host ''
    $confirm = Read-Host '    Continue anyway? (y/N)'
    if ($confirm -notmatch '^[Yy]') {
        Write-Host '    Installation cancelled.' -ForegroundColor Red
        exit 1
    }
}

# Admin check (belt-and-suspenders beyond #Requires)
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]'Administrator')
if (-not $isAdmin) { Write-Fail 'Must be run as Administrator' }
Write-OK 'Running as Administrator'

# BC OData reachable?
if (-not (Test-Port -Port $BCPort)) {
    Write-Host "    ⚠ Cannot reach localhost:$BCPort — BC OData may not be running." -ForegroundColor Yellow
    Write-Host '      Continuing install; start BC and verify connectivity afterwards.' -ForegroundColor Yellow
} else {
    Write-OK "Business Central OData reachable on port $BCPort"
}

# ── Step 2: Directory structure ────────────────────────────────────────────────

Write-Step 'Creating directory structure'

@($InstallRoot, $AgentDir, $CloudflaredDir, $LogDir) | ForEach-Object {
    if (-not (Test-Path $_)) { New-Item -ItemType Directory -Path $_ -Force | Out-Null }
}
Write-OK "Directories created under $InstallRoot"

# ── Step 3: Download cloudflared ───────────────────────────────────────────────

Write-Step 'Downloading cloudflared.exe'

if (Test-Path $CloudflaredExe) {
    Write-OK 'cloudflared.exe already present — skipping download'
} else {
    Write-Host '    Downloading from GitHub releases...' -NoNewline
    try {
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $CloudflaredUrl -OutFile $CloudflaredExe -UseBasicParsing
        Write-Host ' done.' -ForegroundColor Green
    } catch {
        Write-Fail "Failed to download cloudflared: $_"
    }
}

$cfVersion = & $CloudflaredExe --version 2>&1 | Select-Object -First 1
Write-OK "cloudflared version: $cfVersion"

# ── Step 4: Write BCAgent.ps1 ──────────────────────────────────────────────────

Write-Step 'Installing BCAgent v2.3'

$AgentCode = @'
#Requires -Version 5.1
<#
  BCAgent v2.3 — BespoxAI local proxy for Business Central OData
  Validates X-BespoxAI-Key, forwards requests to BC with NTLM auth.
  v2.1: Accept-Encoding fix. v2.2: POST body forwarding.
  v2.3: /bespoxai/objects/export — NAV C/AL object export.
#>

$ConfigPath = Join-Path $PSScriptRoot 'agent.config.json'
if (-not (Test-Path $ConfigPath)) {
    Write-Error "Config not found: $ConfigPath"; exit 1
}

$Config     = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$ListenPort    = if ($Config.listenPort) { $Config.listenPort } else { 8080 }
$ApiKey        = $Config.apiKey
$BCBase        = $Config.bcBaseUrl   # e.g. http://localhost:8048
$BCUser        = $Config.bcUsername
$BCPass        = $Config.bcPassword
$NavDbServer   = if ($Config.navDatabaseServer) { $Config.navDatabaseServer } else { 'localhost' }
$NavDbName     = $Config.navDatabaseName
$NavServerInst = $Config.navServerInstance

$LogFile    = Join-Path (Split-Path $PSScriptRoot) 'Logs\agent.log'
function Write-Log {
    param($msg)
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
    Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue
    Write-Host $line
}

# HTTP listener
$Listener = [System.Net.HttpListener]::new()
$Listener.Prefixes.Add("http://+:$ListenPort/")

try {
    $Listener.Start()
    Write-Log "BCAgent v2.2 started — listening on port $ListenPort"
} catch {
    Write-Log "FATAL: Could not start listener on port ${ListenPort}: $_"
    exit 1
}

# Credential for NTLM
$SecPass = ConvertTo-SecureString $BCPass -AsPlainText -Force
$Cred    = [System.Net.NetworkCredential]::new($BCUser, $SecPass)

while ($Listener.IsListening) {
    try {
        $ctx = $Listener.GetContext()
        $req = $ctx.Request
        $res = $ctx.Response
    } catch {
        if ($Listener.IsListening) { Write-Log "Listener error: $_" }
        continue
    }

    try {
        $rawUrl = $req.RawUrl

        # Health check — requires valid API key so dashboard shows red on config mismatch
        if ($rawUrl -eq '/health' -or $rawUrl -eq '/health/') {
            $incomingKey = $req.Headers['X-BespoxAI-Key']
            $statusCode  = if ($incomingKey -eq $ApiKey) { 200 } else { 401 }
            $statusMsg   = if ($incomingKey -eq $ApiKey) { 'ok' } else { 'unauthorized' }
            $body = [System.Text.Encoding]::UTF8.GetBytes("{`"status`":`"$statusMsg`",`"version`":`"2.3`"}")
            $res.StatusCode = $statusCode
            $res.ContentType = 'application/json'
            $res.ContentLength64 = $body.Length
            $res.OutputStream.Write($body, 0, $body.Length)
            $res.Close()
            continue
        }

        # BCAgent-local: NAV object export endpoint (v2.3)
        if ($rawUrl -like '/bespoxai/objects/export*' -and $req.HttpMethod -eq 'POST') {
            $incomingKey = $req.Headers['X-BespoxAI-Key']
            if ($incomingKey -ne $ApiKey) { $res.StatusCode = 401; $res.Close(); continue }
            try {
                $bodyLen   = $req.ContentLength64
                $bodyBytes = New-Object byte[] $bodyLen
                [void]$req.InputStream.Read($bodyBytes, 0, $bodyLen)
                $body    = [System.Text.Encoding]::UTF8.GetString($bodyBytes) | ConvertFrom-Json
                $objects = $body.objects

                if (-not $NavDbName) { throw 'navDatabaseName not configured. Set it in the BC Installer tab and regenerate the installer.' }
                if (-not $objects -or $objects.Count -eq 0) { throw 'No objects specified.' }

                # Try to load NAV management module from standard paths
                $navPaths = @(
                    'C:\Program Files (x86)\Microsoft Dynamics NAV\*\Service\NavAdminTool.ps1',
                    'C:\Program Files\Microsoft Dynamics NAV\*\Service\NavAdminTool.ps1'
                )
                foreach ($pat in $navPaths) {
                    $f = Get-Item -Path $pat -ErrorAction SilentlyContinue | Select-Object -First 1
                    if ($f) { . $f.FullName; break }
                }

                $tempId  = [System.Guid]::NewGuid().ToString('N')
                $tempDir = [System.IO.Path]::GetTempPath()
                $tempTxt = Join-Path $tempDir "$tempId.txt"
                $tempZip = Join-Path $tempDir "$tempId.zip"

                $exportArgs = @{ DatabaseServer = $NavDbServer; DatabaseName = $NavDbName; Path = $tempTxt; Force = $true }
                if ($NavServerInst) { $exportArgs['ServerInstance'] = $NavServerInst }

                foreach ($obj in $objects) {
                    $filter = "Type=$($obj.type);Id=$($obj.id)"
                    Write-Log "NAV export: $filter"
                    try { Export-NAVApplicationObject @exportArgs -Filter $filter -ErrorAction Stop }
                    catch { Write-Log "Skip $filter`: $_" }
                }

                if (-not (Test-Path $tempTxt) -or (Get-Item $tempTxt).Length -eq 0) {
                    throw 'Export produced no output. Check object IDs, database name, and that the NAV management module is installed.'
                }

                Compress-Archive -Path $tempTxt -DestinationPath $tempZip -Force
                $zipBytes = [System.IO.File]::ReadAllBytes($tempZip)
                Remove-Item $tempTxt, $tempZip -ErrorAction SilentlyContinue
                Write-Log "Export OK: $($objects.Count) objects, $($zipBytes.Length) bytes"

                $res.StatusCode = 200
                $res.ContentType = 'application/zip'
                $res.Headers.Add('Content-Disposition', 'attachment; filename="nav-objects.zip"')
                $res.ContentLength64 = $zipBytes.Length
                $res.OutputStream.Write($zipBytes, 0, $zipBytes.Length)
            } catch {
                Write-Log "Export ERROR: $_"
                $em = ($_.ToString() -replace '"', "'") -replace '[\r\n]+', ' '
                $eb = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$em`"}")
                $res.StatusCode = 500; $res.ContentType = 'application/json'
                $res.ContentLength64 = $eb.Length
                $res.OutputStream.Write($eb, 0, $eb.Length)
            }
            $res.Close(); continue
        }

        # Validate API key
        $incomingKey = $req.Headers['X-BespoxAI-Key']
        if ($incomingKey -ne $ApiKey) {
            Write-Log "401 Unauthorized — bad or missing API key from $($req.RemoteEndPoint)"
            $res.StatusCode = 401
            $res.Close()
            continue
        }

        # Build target URL
        $targetUrl = $BCBase.TrimEnd('/') + $rawUrl
        Write-Log "→ $($req.HttpMethod) $targetUrl"

        # Forward with NTLM
        $handler = [System.Net.Http.HttpClientHandler]::new()
        $handler.Credentials = $Cred
        $handler.PreAuthenticate = $true

        $client = [System.Net.Http.HttpClient]::new($handler)
        $client.Timeout = [TimeSpan]::FromSeconds(60)

        $fwdReq = [System.Net.Http.HttpRequestMessage]::new(
            [System.Net.Http.HttpMethod]::new($req.HttpMethod),
            $targetUrl
        )
        $fwdReq.Headers.TryAddWithoutValidation('Accept', 'application/json') | Out-Null
        $fwdReq.Headers.TryAddWithoutValidation('Accept-Encoding', 'identity') | Out-Null  # v2.1 gzip fix

        # v2.2: Forward request body for POST/PATCH/PUT (enables BC management/automation APIs)
        if ($req.HttpMethod -notin @('GET','HEAD','OPTIONS')) {
            if ($req.ContentLength64 -gt 0) {
                $bodyBytes = New-Object byte[] $req.ContentLength64
                [void]$req.InputStream.Read($bodyBytes, 0, $bodyBytes.Length)
                $bodyContent = [System.Net.Http.ByteArrayContent]::new($bodyBytes)
                $ctHeader = if ($req.ContentType) { $req.ContentType } else { 'application/json' }
                $bodyContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse($ctHeader)
                $fwdReq.Content = $bodyContent
            }
        }

        $fwdRes  = $client.SendAsync($fwdReq).GetAwaiter().GetResult()
        $bytes   = $fwdRes.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
        $ct      = if ($fwdRes.Content.Headers.ContentType) { $fwdRes.Content.Headers.ContentType.ToString() } else { 'application/json' }

        Write-Log "← $([int]$fwdRes.StatusCode) ($($bytes.Length) bytes)"

        $res.StatusCode      = [int]$fwdRes.StatusCode
        $res.ContentType     = $ct
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
        $res.Close()

        $client.Dispose()
        $handler.Dispose()

    } catch {
        Write-Log "ERROR handling request: $_"
        try {
            $res.StatusCode = 500
            $errBytes = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$_`"}")
            $res.ContentLength64 = $errBytes.Length
            $res.OutputStream.Write($errBytes, 0, $errBytes.Length)
            $res.Close()
        } catch {}
    }
}
'@

Set-Content -Path $AgentScript -Value $AgentCode -Encoding UTF8 -Force
Write-OK "BCAgent.ps1 written to $AgentScript"

# ── Step 5: Write agent.config.json ───────────────────────────────────────────

Write-Step 'Writing agent configuration'

$Config = [ordered]@{
    apiKey            = $ApiKey
    listenPort        = $AgentPort
    bcBaseUrl         = "http://localhost:$BCPort"
    bcUsername        = $BCUsername
    bcPassword        = $BCPassword
    bcInstance        = $BCInstance
    bcCompany         = $BCCompany
    navDatabaseServer = $NavDatabaseServer
    navDatabaseName   = $NavDatabaseName
    navServerInstance = $NavServerInstance
    version           = '2.3'
    installedAt       = (Get-Date -Format 'o')
}

$Config | ConvertTo-Json | Set-Content -Path $AgentConfig -Encoding UTF8 -Force

# Lock config file to Administrators + SYSTEM only
$acl = Get-Acl $AgentConfig
$acl.SetAccessRuleProtection($true, $false)
$adminRule  = [System.Security.AccessControl.FileSystemAccessRule]::new('Administrators','FullControl','Allow')
$systemRule = [System.Security.AccessControl.FileSystemAccessRule]::new('SYSTEM','FullControl','Allow')
$acl.AddAccessRule($adminRule)
$acl.AddAccessRule($systemRule)
Set-Acl -Path $AgentConfig -AclObject $acl

Write-OK "agent.config.json written (permissions locked to Administrators + SYSTEM)"

# ── Step 6: Install cloudflared tunnel service ─────────────────────────────────

Write-Step 'Installing Cloudflare tunnel service'

# Remove existing service if present
$cfSvc = Get-Service -Name 'cloudflared' -ErrorAction SilentlyContinue
if ($cfSvc) {
    Write-Host '    Removing existing cloudflared service...' -NoNewline
    if ($cfSvc.Status -eq 'Running') { Stop-Service -Name 'cloudflared' -Force }
    & $CloudflaredExe service uninstall 2>&1 | Out-Null
    Start-Sleep -Seconds 2
    Write-Host ' done.'
}

# Install tunnel with token
& $CloudflaredExe service install $TunnelToken 2>&1 | ForEach-Object { Write-Host "    $_" }
Start-Sleep -Seconds 2

$cfSvc = Get-Service -Name 'cloudflared' -ErrorAction SilentlyContinue
if (-not $cfSvc) {
    Write-Fail 'cloudflared service was not created — check the tunnel token and try again'
}
Write-OK 'cloudflared service installed'

# ── Step 7: Install BCAgent as a scheduled task ────────────────────────────────

Write-Step 'Installing BCAgent scheduled task'

$TaskName = 'BespoxAI-BCAgent'

# Remove existing task
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$PsExe   = "$($env:SystemRoot)\System32\WindowsPowerShell\v1.0\powershell.exe"
$PsArgs  = "-NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$AgentScript`""

$Action   = New-ScheduledTaskAction -Execute $PsExe -Argument $PsArgs -WorkingDirectory $AgentDir
$Trigger  = New-ScheduledTaskTrigger -AtStartup
$Settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 `
    -RestartInterval ([TimeSpan]::FromMinutes(1)) `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable:$false

$Principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask `
    -TaskName  $TaskName `
    -Action    $Action `
    -Trigger   $Trigger `
    -Settings  $Settings `
    -Principal $Principal `
    -Force | Out-Null

Write-OK "Scheduled task '$TaskName' created (runs as SYSTEM at startup)"

# ── Step 8: Start services ─────────────────────────────────────────────────────

Write-Step 'Starting services'

# Start cloudflared
Start-Service -Name 'cloudflared'
Start-Sleep -Seconds 3
$cfStatus = (Get-Service -Name 'cloudflared').Status
if ($cfStatus -ne 'Running') { Write-Fail "cloudflared failed to start (status: $cfStatus)" }
Write-OK 'cloudflared tunnel running'

# Start BCAgent
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 4
Write-OK 'BCAgent started'

# ── Step 9: Health check ───────────────────────────────────────────────────────

Write-Step 'Verifying BCAgent health'

$maxAttempts = 6
$healthy     = $false

for ($i = 1; $i -le $maxAttempts; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:$AgentPort/health" `
            -Headers @{ 'X-BespoxAI-Key' = $ApiKey } `
            -UseBasicParsing -TimeoutSec 5
        if ($resp.StatusCode -eq 200) { $healthy = $true; break }
    } catch {}
    Write-Host "    Waiting for BCAgent... (attempt $i/$maxAttempts)"
    Start-Sleep -Seconds 3
}

if ($healthy) {
    Write-OK "BCAgent health check passed — http://localhost:$AgentPort/health"
} else {
    Write-Host ''
    Write-Host '    ⚠ BCAgent did not respond in time. It may still be starting.' -ForegroundColor Yellow
    Write-Host "      Check the log at: $LogDir\agent.log" -ForegroundColor Yellow
}

# ── Done ───────────────────────────────────────────────────────────────────────

Write-Host ''
Write-Host '  ╔══════════════════════════════════════════════╗' -ForegroundColor Green
Write-Host '  ║         Installation Complete  ✓             ║' -ForegroundColor Green
Write-Host '  ╚══════════════════════════════════════════════╝' -ForegroundColor Green
Write-Host ''
Write-Host '  Services installed:' -ForegroundColor White
Write-Host "    • cloudflared    — Windows Service  (auto-start)"
Write-Host "    • BCAgent v2.3   — Scheduled Task   (auto-start at boot)"
Write-Host ''
Write-Host '  Files:' -ForegroundColor White
Write-Host "    • $AgentScript"
Write-Host "    • $AgentConfig"
Write-Host "    • $CloudflaredExe"
Write-Host "    • $LogDir\agent.log"
Write-Host ''
Write-Host '  Manage services:' -ForegroundColor White
Write-Host "    Start-Service cloudflared"
Write-Host "    Stop-Service  cloudflared"
Write-Host "    Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "    Stop-ScheduledTask  -TaskName '$TaskName'"
Write-Host ''
Write-Host '  Uninstall:' -ForegroundColor White
Write-Host "    & '$CloudflaredExe' service uninstall"
Write-Host "    Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
Write-Host "    Remove-Item '$InstallRoot' -Recurse -Force"
Write-Host ''
