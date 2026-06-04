#Requires -RunAsAdministrator
#Requires -Version 5.1
<#
.SYNOPSIS
    BespoxAI Installer v2.4
    Sets up BCAgent (local OData proxy) and a Cloudflare tunnel so BespoxAI
    can query your Business Central data securely from bespoxai.com.

.DESCRIPTION
    This script:
      1. Creates C:\BespoxAI\ directory structure
      2. Downloads cloudflared.exe (Cloudflare Tunnel client)
      3. Installs BCAgent v2.4 (local NTLM proxy + NAV export/import + deployment workflow)
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
    Local port for BCAgent to listen on. Default: 9099
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
    [int]    $AgentPort   = 9099,
    [string] $NavDatabaseServer = 'localhost',
    [string] $NavDatabaseName   = '',
    [string] $NavServerInstance    = '',
    [int]    $NavManagementPort    = 7045,
    [string] $TestNavDatabaseServer = '',
    [string] $TestNavDatabaseName   = '',
    [string] $TestNavServerInstance = '',
    [string] $TestBcInstance        = '',
    [string] $TestBcCompany         = '',
    [int]    $TestBcPort            = 0,
    [int]    $TestNavManagementPort  = 7045,
    [string] $SupportAccountPassword = '',
    [string] $BrandName = 'BespoxAI'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$AgentVersion  = '3.2'

# ── Paths ──────────────────────────────────────────────────────────────────────

$InstallRoot   = "C:\$BrandName"
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
Write-Host "  ║        $BrandName Installer  v$AgentVersion              ║" -ForegroundColor DarkCyan
Write-Host '  ║  Business Central → AI Query Layer           ║' -ForegroundColor DarkCyan
Write-Host '  ╚══════════════════════════════════════════════╝' -ForegroundColor DarkCyan
Write-Host ''
Write-Host '  Production Environment' -ForegroundColor Cyan
Write-Host "    DB Server      : $NavDatabaseServer"
Write-Host "    DB Name        : $NavDatabaseName"
Write-Host "    NAV Instance   : $NavServerInstance"
Write-Host "    Mgmt Port      : $NavManagementPort"
Write-Host "    BC Instance    : $BCInstance"
Write-Host "    BC Company     : $BCCompany"
Write-Host "    BC Port        : $BCPort"
Write-Host "    Agent Port     : $AgentPort"
Write-Host "    BC User        : $BCUsername"
Write-Host ''
Write-Host '  Test Environment' -ForegroundColor Cyan
Write-Host "    DB Name        : $TestNavDatabaseName"
Write-Host "    DB Server      : $(if ($TestNavDatabaseServer) { $TestNavDatabaseServer } else { "$NavDatabaseServer (same as prod)" })"
Write-Host "    NAV Instance   : $TestNavServerInstance"
Write-Host "    BC Instance    : $TestBcInstance"
Write-Host "    BC Company     : $(if ($TestBcCompany) { $TestBcCompany } else { '(same as prod)' })"
Write-Host "    Mgmt Port      : $TestNavManagementPort"
Write-Host ''

# ── Step 1: Prerequisites ──────────────────────────────────────────────────────

Write-Step 'Checking prerequisites'

# Stop any existing BespoxAI agent before checking port
$existingTask = Get-ScheduledTask -TaskName "$BrandName-BCAgent" -ErrorAction SilentlyContinue
if ($existingTask) {
    Write-Host "    Stopping existing $BrandName agent..." -ForegroundColor Cyan

    # 1. Stop the scheduled task
    Stop-ScheduledTask -TaskName "$BrandName-BCAgent" -ErrorAction SilentlyContinue

    # 2. Kill any BCAgent.ps1 PowerShell processes directly
    $bcProcs = Get-WmiObject Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like '*BCAgent.ps1*' }
    foreach ($proc in $bcProcs) {
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
    }

    # 3. Remove HTTP.sys URL ACL reservation (HttpListener registers with kernel, not as a process)
    $urlacls = & netsh http show urlacl 2>&1 | Select-String "http://\+:$AgentPort/"
    if ($urlacls) {
        foreach ($entry in $urlacls) {
            $url = ($entry.ToString().Trim() -split '\s+')[-1]
            & netsh http delete urlacl url=$url 2>&1 | Out-Null
        }
    }

    # Wait up to 5s for port to free
    $waited = 0
    while ((Test-Port -Port $AgentPort) -and $waited -lt 5) {
        Start-Sleep -Seconds 1; $waited++
    }
    if ($waited -gt 0) { Write-OK "Agent stopped (waited ${waited}s)" } else { Write-OK 'Agent stopped' }
}

# Port conflict check — only warn if still in use after all cleanup attempts
if (Test-Port -Port $AgentPort) {
    Write-Host ''
    Write-Host "    ⚠ Port $AgentPort is still in use by another service (not $BrandName)." -ForegroundColor Yellow
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

Write-Step "Installing $BrandName agent v$AgentVersion"

$AgentCode = @'
#Requires -Version 5.1
<#
  BCAgent v$AgentVersion — $BrandName local proxy for Business Central OData
  Validates X-BespoxAI-Key, forwards requests to BC with NTLM auth.
  v2.1: Accept-Encoding fix. v2.2: POST body forwarding.
  v2.3: /bespoxai/objects/export — NAV C/AL object export.
#>

$Version    = '3.2'
$ConfigPath = Join-Path $PSScriptRoot 'agent.config.json'
if (-not (Test-Path $ConfigPath)) {
    Write-Error "Config not found: $ConfigPath"; exit 1
}

$Config     = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$ListenPort    = if ($Config.listenPort) { $Config.listenPort } else { 9099 }
$ApiKey        = $Config.apiKey
$BCBase        = $Config.bcBaseUrl   # e.g. http://localhost:8048
$BCUser        = $Config.bcUsername
$BCPass        = $Config.bcPassword
$NavDbServer   = if ($Config.navDatabaseServer) { $Config.navDatabaseServer } else { 'localhost' }
$NavDbName     = $Config.navDatabaseName
$NavServerInst       = $Config.navServerInstance
$NavMgmtPort         = if ($Config.navManagementPort) { $Config.navManagementPort } else { 7045 }
$TestNavDbServer     = if ($Config.testNavDatabaseServer) { $Config.testNavDatabaseServer } else { $NavDbServer }
$TestNavDbName       = $Config.testNavDatabaseName
$TestNavServerInst   = $Config.testNavServerInstance
$TestBcInstance      = $Config.testBcInstance
$TestBcCompany       = $Config.testBcCompany
$TestBcPort          = if ($Config.testBcPort) { $Config.testBcPort } else { 0 }
$TestNavMgmtPort     = if ($Config.testNavManagementPort) { $Config.testNavManagementPort } else { 7045 }

$LogFile    = Join-Path (Split-Path $PSScriptRoot) 'Logs\agent.log'
function Write-Log {
    param($msg)
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
    Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue
    Write-Host $line
}

# Read full request body — Stream.Read() may return fewer bytes than requested
# on large payloads, so we loop until all bytes are consumed.
function Read-RequestBody {
    param($req)
    $bodyLen = $req.ContentLength64
    if ($bodyLen -le 0) { return '' }
    $bodyBytes = New-Object byte[] $bodyLen
    $offset = 0
    while ($offset -lt $bodyLen) {
        $read = $req.InputStream.Read($bodyBytes, $offset, $bodyLen - $offset)
        if ($read -le 0) { break }
        $offset += $read
    }
    return [System.Text.Encoding]::UTF8.GetString($bodyBytes, 0, $offset)
}

# HTTP listener
$Listener = [System.Net.HttpListener]::new()
$Listener.Prefixes.Add("http://+:$ListenPort/")

try {
    $Listener.Start()
    Write-Log "BCAgent v$Version started — listening on port $ListenPort"
} catch {
    Write-Log "FATAL: Could not start listener on port ${ListenPort}: $_"
    exit 1
}

# BCAgent runs as the BC user account (set in scheduled task).
# UseDefaultCredentials lets Windows handle NTLM/Kerberos via the process token --
# same mechanism as browser SSO, no explicit credential injection needed.

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
            $body = [System.Text.Encoding]::UTF8.GetBytes("{`"status`":`"$statusMsg`",`"version`":`"$Version`"}")
            $res.StatusCode = $statusCode
            $res.ContentType = 'application/json'
            $res.ContentLength64 = $body.Length
            $res.OutputStream.Write($body, 0, $body.Length)
            $res.Close()
            continue
        }

        # BCAgent-local: Write deployment files to server (v2.4)
        if ($rawUrl -like '/bespoxai/objects/write*' -and $req.HttpMethod -eq 'POST') {
            $incomingKey = $req.Headers['X-BespoxAI-Key']
            if ($incomingKey -ne $ApiKey) { $res.StatusCode = 401; $res.Close(); continue }
            try {
                $bodyLen   = $req.ContentLength64
                $bodyBytes = New-Object byte[] $bodyLen
                $offset = 0; while ($offset -lt $bodyLen) { $read = $req.InputStream.Read($bodyBytes, $offset, $bodyLen - $offset); if ($read -le 0) { break }; $offset += $read }
                $body    = [System.Text.Encoding]::UTF8.GetString($bodyBytes, 0, $offset) | ConvertFrom-Json
                $objects = $body.objects          # [{filename, content}]
                $requirementId = if ($body.requirementId) { $body.requirementId -replace '[^a-zA-Z0-9_-]','' } else { 'unknown' }
                $timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'

                if (-not $objects -or $objects.Count -eq 0) { throw 'No objects provided.' }

                $deployDir = "C:\$BrandName\Deployments\$requirementId\${timestamp}_deploy"
                New-Item -ItemType Directory -Path $deployDir -Force | Out-Null

                foreach ($obj in $objects) {
                    $safeName = $obj.filename -replace '[^a-zA-Z0-9_\-. ]',''
                    Set-Content -Path "$deployDir\$safeName" -Value $obj.content -Encoding UTF8
                }

                # Write manifest
                $manifest = @{
                    requirementId = $requirementId
                    type          = 'deployment'
                    timestamp     = (Get-Date -Format 'o')
                    objects       = @($objects | ForEach-Object { $_.filename })
                    status        = 'written'
                } | ConvertTo-Json
                Set-Content -Path "$deployDir\_manifest.json" -Value $manifest -Encoding UTF8
                Write-Log "Deployment written: $deployDir ($($objects.Count) objects)"

                $deployDirEsc = $deployDir.Replace('\','\\')
                $resp = [System.Text.Encoding]::UTF8.GetBytes("{`"snapshotId`":`"${timestamp}_deploy`",`"path`":`"$deployDirEsc`",`"objectCount`":$($objects.Count)}")
                $res.StatusCode = 200; $res.ContentType = 'application/json'
                $res.ContentLength64 = $resp.Length
                $res.OutputStream.Write($resp, 0, $resp.Length)
            } catch {
                Write-Log "Write ERROR: $_"
                $em = ($_.ToString() -replace '"',"'") -replace '[\r\n]+',' '
                $eb = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$em`"}")
                $res.StatusCode = 500; $res.ContentType = 'application/json'
                $res.ContentLength64 = $eb.Length; $res.OutputStream.Write($eb, 0, $eb.Length)
            }
            $res.Close(); continue
        }

        # BCAgent-local: Deploy from folder to test or production (v2.4)
        if ($rawUrl -like '/bespoxai/objects/deploy*' -and $req.HttpMethod -eq 'POST') {
            $incomingKey = $req.Headers['X-BespoxAI-Key']
            if ($incomingKey -ne $ApiKey) { $res.StatusCode = 401; $res.Close(); continue }
            try {
                $bodyLen   = $req.ContentLength64
                $bodyBytes = New-Object byte[] $bodyLen
                $offset = 0; while ($offset -lt $bodyLen) { $read = $req.InputStream.Read($bodyBytes, $offset, $bodyLen - $offset); if ($read -le 0) { break }; $offset += $read }
                $body    = [System.Text.Encoding]::UTF8.GetString($bodyBytes, 0, $offset) | ConvertFrom-Json
                $requirementId = if ($body.requirementId) { $body.requirementId -replace '[^a-zA-Z0-9_-]','' } else { 'unknown' }
                $snapshotId    = $body.snapshotId -replace '[^a-zA-Z0-9_-]',''
                $environment   = if ($body.environment) { $body.environment } else { 'test' }

                # Select database based on environment
                if ($environment -eq 'production') {
                    $dbServer  = $NavDbServer; $dbName = $NavDbName; $dbInst = $NavServerInst
                    $mgmtPort  = $NavMgmtPort
                    if (-not $dbName) { throw "navDatabaseName not configured. Add it in the BC Installer tab." }
                    if (-not $dbInst) { throw "navServerInstance not configured. Add it in the BC Installer tab." }
                } else {
                    $dbServer  = $TestNavDbServer; $dbName = $TestNavDbName
                    $dbInst    = if ($TestNavServerInst) { $TestNavServerInst } else { $TestBcInstance }
                    $mgmtPort  = $TestNavMgmtPort
                    if (-not $dbName) { throw "testNavDatabaseName not configured. Add it in the BC Installer tab." }
                    if (-not $dbInst) { throw "testNavServerInstance not configured. Add it in the BC Installer tab." }
                }

                $deployDir = "C:\$BrandName\Deployments\$requirementId\$snapshotId"
                if (-not (Test-Path $deployDir)) { throw "Snapshot folder not found: $deployDir" }

                # Load NAV/BC modules (management + model tools). BC14 paths first.
                $navModules = @(
                    'C:\Program Files\Microsoft Dynamics 365 Business Central\*\Service\NavAdminTool.ps1',
                    'C:\Program Files (x86)\Microsoft Dynamics 365 Business Central\*\Service\NavAdminTool.ps1',
                    'C:\Program Files\Microsoft Dynamics NAV\*\Service\NavAdminTool.ps1',
                    'C:\Program Files (x86)\Microsoft Dynamics NAV\*\Service\NavAdminTool.ps1',
                    'C:\Program Files\Microsoft Dynamics 365 Business Central\*\RoleTailored Client\NavModelTools.ps1',
                    'C:\Program Files (x86)\Microsoft Dynamics 365 Business Central\*\RoleTailored Client\NavModelTools.ps1',
                    'C:\Program Files\Microsoft Dynamics NAV\*\RoleTailored Client\NavModelTools.ps1',
                    'C:\Program Files (x86)\Microsoft Dynamics NAV\*\RoleTailored Client\NavModelTools.ps1'
                )
                foreach ($pat in $navModules) {
                    $f = Get-Item -Path $pat -ErrorAction SilentlyContinue | Select-Object -First 1
                    if ($f) { . $f.FullName }
                }

                # NavModelTools.ps1 requires $NavIde = path to finsql.exe
                $finsqlSearchPaths = @(
                    'C:\Program Files\Microsoft Dynamics 365 Business Central\*\RoleTailored Client\finsql.exe',
                    'C:\Program Files (x86)\Microsoft Dynamics 365 Business Central\*\RoleTailored Client\finsql.exe',
                    'C:\Program Files\Microsoft Dynamics NAV\*\RoleTailored Client\finsql.exe',
                    'C:\Program Files (x86)\Microsoft Dynamics NAV\*\RoleTailored Client\finsql.exe'
                )
                $NavIde = $null
                foreach ($fp in $finsqlSearchPaths) {
                    $ff = Get-Item -Path $fp -ErrorAction SilentlyContinue | Select-Object -First 1
                    if ($ff) { $NavIde = $ff.FullName; break }
                }
                if (-not $NavIde) { throw 'finsql.exe not found — cannot import/compile objects. Check NAV/BC installation.' }
                Write-Log "Using finsql.exe for NavModelTools: $NavIde"

                $results = @()
                $txtFiles = Get-ChildItem -Path $deployDir -Filter '*.txt' -File

                foreach ($file in $txtFiles) {
                    $fileResult = @{ filename = $file.Name; imported = $false; compiled = $false; error = '' }
                    try {
                        # Import
                        Import-NAVApplicationObject -DatabaseServer $dbServer -DatabaseName $dbName `
                            -Path $file.FullName -ImportAction Overwrite -SynchronizeSchemaChanges Force `
                            -Confirm:$false -ErrorAction Stop
                        $fileResult.imported = $true
                        Write-Log "Imported: $($file.Name) → $dbName"

                        # Parse type+id from filename (Type_Id_Name.txt)
                        $parts = $file.BaseName -split '_'
                        if ($parts.Count -ge 2) {
                            $objType = $parts[0]; $objId = $parts[1]
                            $filter = "Type=$objType;Id=$objId"
                            $compileParams = @{
                                DatabaseServer           = $dbServer
                                DatabaseName             = $dbName
                                Filter                   = $filter
                                SynchronizeSchemaChanges = 'Force'
                                ErrorAction              = 'Stop'
                            }
                            if ($dbInst) {
                                $compileParams['NavServerName']           = 'localhost'
                                $compileParams['NavServerInstance']       = $dbInst
                                $compileParams['NavServerManagementPort'] = $mgmtPort
                            }
                            Compile-NAVApplicationObject @compileParams
                            $fileResult.compiled = $true
                            Write-Log "Compiled: $filter"
                        }
                    } catch {
                        $fileResult.error = $_.ToString() -replace '[\r\n]+',' '
                        Write-Log "Deploy error ($($file.Name)): $_"
                    }
                    $results += $fileResult
                }

                # Update manifest with deploy result
                $manifestPath = "$deployDir\_manifest.json"
                if (Test-Path $manifestPath) {
                    $mf = Get-Content $manifestPath | ConvertFrom-Json
                    $mf | Add-Member -NotePropertyName "${environment}DeployedAt" -NotePropertyValue (Get-Date -Format 'o') -Force
                    $mf | Add-Member -NotePropertyName "status" -NotePropertyValue "deployed_$environment" -Force
                    $mf | ConvertTo-Json | Set-Content $manifestPath -Encoding UTF8
                }

                $success = ($results | Where-Object { -not $_.imported }).Count -eq 0
                $resultsJson = $results | ConvertTo-Json -Compress
                $resp = [System.Text.Encoding]::UTF8.GetBytes("{`"success`":$($success.ToString().ToLower()),`"environment`":`"$environment`",`"results`":$resultsJson}")
                try {
                    $res.StatusCode = 200; $res.ContentType = 'application/json'
                    $res.ContentLength64 = $resp.Length; $res.OutputStream.Write($resp, 0, $resp.Length)
                } catch { Write-Log "Deploy response write failed (client disconnected): $_" }
            } catch {
                Write-Log "Deploy ERROR: $_"
                $em = ($_.ToString() -replace '"',"'") -replace '[\r\n]+',' '
                $eb = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$em`"}")
                try {
                    $res.StatusCode = 500; $res.ContentType = 'application/json'
                    $res.ContentLength64 = $eb.Length; $res.OutputStream.Write($eb, 0, $eb.Length)
                } catch { Write-Log "Deploy error response write failed (client disconnected): $_" }
            }
            $res.Close(); continue
        }

        # BCAgent-local: List regression/deployment snapshots (v2.4)
        if ($rawUrl -like '/bespoxai/objects/snapshots*' -and $req.HttpMethod -eq 'GET') {
            $incomingKey = $req.Headers['X-BespoxAI-Key']
            if ($incomingKey -ne $ApiKey) { $res.StatusCode = 401; $res.Close(); continue }
            try {
                $result = @{ regression = @(); deployments = @() }
                foreach ($tree in @(@{key='regression';path="C:\$BrandName\Regression"}, @{key='deployments';path="C:\$BrandName\Deployments"})) {
                    if (Test-Path $tree.path) {
                        Get-ChildItem $tree.path -Directory | ForEach-Object {
                            $reqId = $_.Name
                            Get-ChildItem $_.FullName -Directory | ForEach-Object {
                                $mfPath = "$($_.FullName)\_manifest.json"
                                if (Test-Path $mfPath) {
                                    $mf = Get-Content $mfPath | ConvertFrom-Json
                                    $mf | Add-Member -NotePropertyName 'requirementId' -NotePropertyValue $reqId -Force
                                    $mf | Add-Member -NotePropertyName 'snapshotId' -NotePropertyValue $_.Name -Force
                                    $result[$tree.key] += $mf
                                }
                            }
                        }
                    }
                }
                $resp = [System.Text.Encoding]::UTF8.GetBytes(($result | ConvertTo-Json -Compress -Depth 5))
                $res.StatusCode = 200; $res.ContentType = 'application/json'
                $res.ContentLength64 = $resp.Length; $res.OutputStream.Write($resp, 0, $resp.Length)
            } catch {
                $em = ($_.ToString() -replace '"',"'") -replace '[\r\n]+',' '
                $eb = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$em`"}")
                $res.StatusCode = 500; $res.ContentType = 'application/json'
                $res.ContentLength64 = $eb.Length; $res.OutputStream.Write($eb, 0, $eb.Length)
            }
            $res.Close(); continue
        }

        # BCAgent-local: Cleanup snapshots (v2.4)
        if ($rawUrl -like '/bespoxai/objects/cleanup*' -and $req.HttpMethod -eq 'POST') {
            $incomingKey = $req.Headers['X-BespoxAI-Key']
            if ($incomingKey -ne $ApiKey) { $res.StatusCode = 401; $res.Close(); continue }
            try {
                $bodyLen = $req.ContentLength64
                $bodyBytes = New-Object byte[] $bodyLen
                $offset = 0; while ($offset -lt $bodyLen) { $read = $req.InputStream.Read($bodyBytes, $offset, $bodyLen - $offset); if ($read -le 0) { break }; $offset += $read }
                $body = [System.Text.Encoding]::UTF8.GetString($bodyBytes, 0, $offset) | ConvertFrom-Json
                $reqId = if ($body.requirementId) { $body.requirementId -replace '[^a-zA-Z0-9_-]','' } else { '' }
                $deleted = 0
                foreach ($base in @("C:\$BrandName\Regression","C:\$BrandName\Deployments")) {
                    if ($reqId) {
                        $target = "$base\$reqId"
                        if (Test-Path $target) { Remove-Item $target -Recurse -Force; $deleted++ }
                    } else {
                        if (Test-Path $base) { Remove-Item "$base\*" -Recurse -Force; $deleted++ }
                    }
                }
                $resp = [System.Text.Encoding]::UTF8.GetBytes("{`"deleted`":$deleted}")
                $res.StatusCode = 200; $res.ContentType = 'application/json'
                $res.ContentLength64 = $resp.Length; $res.OutputStream.Write($resp, 0, $resp.Length)
            } catch {
                $em = ($_.ToString() -replace '"',"'") -replace '[\r\n]+',' '
                $eb = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$em`"}")
                $res.StatusCode = 500; $res.ContentType = 'application/json'
                $res.ContentLength64 = $eb.Length; $res.OutputStream.Write($eb, 0, $eb.Length)
            }
            $res.Close(); continue
        }

        # BCAgent-local: NAV object export endpoint (v2.3→v2.4 + regression save)
        if ($rawUrl -like '/bespoxai/objects/export*' -and $req.HttpMethod -eq 'POST') {
            $incomingKey = $req.Headers['X-BespoxAI-Key']
            if ($incomingKey -ne $ApiKey) { $res.StatusCode = 401; $res.Close(); continue }
            try {
                $bodyLen   = $req.ContentLength64
                $bodyBytes = New-Object byte[] $bodyLen
                $offset = 0; while ($offset -lt $bodyLen) { $read = $req.InputStream.Read($bodyBytes, $offset, $bodyLen - $offset); if ($read -le 0) { break }; $offset += $read }
                $body    = [System.Text.Encoding]::UTF8.GetString($bodyBytes, 0, $offset) | ConvertFrom-Json
                $objects       = $body.objects
                $requirementId = if ($body.requirementId) { $body.requirementId -replace '[^a-zA-Z0-9_-]','' } else { 'unknown' }
                $timestamp     = Get-Date -Format 'yyyyMMdd_HHmmss'

                if (-not $NavDbName) { throw 'navDatabaseName not configured. Set it in the BC Installer tab and regenerate the installer.' }
                if (-not $objects -or $objects.Count -eq 0) { throw 'No objects specified.' }

                # Load NAV/BC management + model tools modules.
                # Searches both legacy NAV and BC14+ paths. Loads all found.
                # BC14 path: Microsoft Dynamics 365 Business Central\140\...
                # NAV path:  Microsoft Dynamics NAV\<ver>\...
                $navModules = @(
                    'C:\Program Files\Microsoft Dynamics 365 Business Central\*\Service\NavAdminTool.ps1',
                    'C:\Program Files (x86)\Microsoft Dynamics 365 Business Central\*\Service\NavAdminTool.ps1',
                    'C:\Program Files\Microsoft Dynamics NAV\*\Service\NavAdminTool.ps1',
                    'C:\Program Files (x86)\Microsoft Dynamics NAV\*\Service\NavAdminTool.ps1',
                    'C:\Program Files\Microsoft Dynamics 365 Business Central\*\RoleTailored Client\NavModelTools.ps1',
                    'C:\Program Files (x86)\Microsoft Dynamics 365 Business Central\*\RoleTailored Client\NavModelTools.ps1',
                    'C:\Program Files\Microsoft Dynamics NAV\*\RoleTailored Client\NavModelTools.ps1',
                    'C:\Program Files (x86)\Microsoft Dynamics NAV\*\RoleTailored Client\NavModelTools.ps1'
                )
                foreach ($pat in $navModules) {
                    $f = Get-Item -Path $pat -ErrorAction SilentlyContinue | Select-Object -First 1
                    if ($f) { . $f.FullName }
                }

                $tempId  = [System.Guid]::NewGuid().ToString('N')
                $tempDir = [System.IO.Path]::GetTempPath()
                $tempTxt = Join-Path $tempDir "$tempId.txt"
                $tempZip = Join-Path $tempDir "$tempId.zip"

                # Use finsql.exe directly for C/AL export — proven reliable across NAV and BC14.
                # Export-NAVApplicationObject is version-dependent and requires $NavIde anyway,
                # so finsql direct is simpler and more predictable.
                # BC14 paths first (highest version), then legacy NAV.
                $finsqlPaths = @(
                    'C:\Program Files\Microsoft Dynamics 365 Business Central\*\RoleTailored Client\finsql.exe',
                    'C:\Program Files (x86)\Microsoft Dynamics 365 Business Central\*\RoleTailored Client\finsql.exe',
                    'C:\Program Files\Microsoft Dynamics NAV\*\RoleTailored Client\finsql.exe',
                    'C:\Program Files (x86)\Microsoft Dynamics NAV\*\RoleTailored Client\finsql.exe'
                )
                $finsql = $null
                foreach ($fp in $finsqlPaths) {
                    $ff = Get-Item -Path $fp -ErrorAction SilentlyContinue | Sort-Object { $_.VersionInfo.FileVersion } -Descending | Select-Object -First 1
                    if ($ff) { $finsql = $ff.FullName; break }
                }
                if (-not $finsql) { throw 'finsql.exe not found. Check NAV/BC installation.' }
                Write-Log "Using finsql.exe: $finsql"

                $tempLog = Join-Path $tempDir "$tempId.log"
                $chunks  = [System.Collections.Generic.List[string]]::new()

                # Group objects by type — one finsql call per type with combined ID filter.
                # e.g. Type=Table;ID=27|37 instead of two separate launches.
                # Reduces remote SQL connection overhead significantly.
                $byType = @{}
                foreach ($obj in $objects) {
                    if (-not $byType.ContainsKey($obj.type)) { $byType[$obj.type] = [System.Collections.Generic.List[string]]::new() }
                    $byType[$obj.type].Add([string]$obj.id)
                }

                foreach ($objType in $byType.Keys) {
                    $idList    = $byType[$objType] -join '|'
                    $filter    = "Type=$objType;ID=$idList"
                    $chunkFile = Join-Path $tempDir "$tempId-$objType.txt"
                    Write-Log "NAV export (finsql): $filter"
                    $finsqlArgs = "command=ExportObjects,id=BespoxAI,database=$NavDbName,servername=$NavDbServer,ntauthentication=yes,filter=$filter,file=$chunkFile,logfile=$tempLog"
                    $proc = Start-Process -FilePath $finsql -ArgumentList $finsqlArgs -Wait -PassThru -WindowStyle Hidden
                    if ($proc.ExitCode -ne 0 -or -not (Test-Path $chunkFile) -or (Get-Item $chunkFile).Length -eq 0) {
                        $logMsg = if (Test-Path $tempLog) { Get-Content $tempLog -Raw } else { 'no log' }
                        Write-Log "Skip $filter (exit $($proc.ExitCode)): $logMsg"
                    } else {
                        $chunks.Add($chunkFile)
                    }
                }

                if ($chunks.Count -gt 0) {
                    # Concatenate chunk files into a single UTF-8 file.
                    # Use Get-Content -Raw which auto-detects BOM (UTF-16 LE/BE, UTF-8)
                    # and falls back to ANSI if no BOM. Avoids manual byte-decode errors
                    # where finsql writes ANSI but we were treating it as UTF-16 LE.
                    $utf8NoBomEarly = New-Object System.Text.UTF8Encoding $false
                    $combined = [System.Text.StringBuilder]::new()
                    foreach ($chunk in $chunks) {
                        $text = Get-Content $chunk -Raw
                        [void]$combined.AppendLine($text.TrimEnd())
                        Remove-Item $chunk -Force -ErrorAction SilentlyContinue
                    }
                    [System.IO.File]::WriteAllText($tempTxt, $combined.ToString(), $utf8NoBomEarly)
                    Write-Log "finsql export joined $($chunks.Count) type(s) to UTF-8"
                }
                Remove-Item $tempLog -Force -ErrorAction SilentlyContinue

                if (-not (Test-Path $tempTxt) -or (Get-Item $tempTxt).Length -eq 0) {
                    throw 'Export produced no output. Check object IDs, database name, and that the NAV management module is installed.'
                }

                # Save regression snapshot
                $regressionDir = "C:\$BrandName\Regression\$requirementId\${timestamp}_fetch"
                New-Item -ItemType Directory -Path $regressionDir -Force | Out-Null
                $manifest = @{ requirementId=$requirementId; type='fetch'; timestamp=(Get-Date -Format 'o'); objects=@($objects|ForEach-Object{"$($_.type) $($_.id)"}) } | ConvertTo-Json
                Set-Content -Path "$regressionDir\_manifest.json" -Value $manifest -Encoding UTF8
                if (Test-Path $tempTxt) { Copy-Item $tempTxt -Destination $regressionDir -Force }
                Write-Log "Regression saved: $regressionDir"

                # Normalize encoding to UTF-8 before zipping.
                # Export-NAVApplicationObject writes UTF-16 LE (BOM FF FE) by default.
                # JSZip reads zip entries as Latin-1, so UTF-16 LE produces garbled text
                # and OBJECT headers never match. Re-encode here so the client gets clean UTF-8.
                $fileBytes = [System.IO.File]::ReadAllBytes($tempTxt)
                $utf8NoBom = New-Object System.Text.UTF8Encoding $false
                if ($fileBytes.Length -ge 2 -and $fileBytes[0] -eq 0xFF -and $fileBytes[1] -eq 0xFE) {
                    # UTF-16 LE with BOM
                    $rawContent = [System.Text.Encoding]::Unicode.GetString($fileBytes, 2, $fileBytes.Length - 2)
                    [System.IO.File]::WriteAllText($tempTxt, $rawContent, $utf8NoBom)
                    Write-Log 'Re-encoded C/AL output: UTF-16 LE -> UTF-8'
                } elseif ($fileBytes.Length -ge 3 -and $fileBytes[0] -eq 0xEF -and $fileBytes[1] -eq 0xBB -and $fileBytes[2] -eq 0xBF) {
                    # UTF-8 with BOM -- strip it so the first line starts cleanly with OBJECT
                    $rawContent = [System.Text.Encoding]::UTF8.GetString($fileBytes, 3, $fileBytes.Length - 3)
                    [System.IO.File]::WriteAllText($tempTxt, $rawContent, $utf8NoBom)
                    Write-Log 'Stripped UTF-8 BOM from C/AL output'
                }
                # else: no BOM -- assume ANSI/UTF-8, leave as-is

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

        # BCAgent-local: Sync config from portal (v2.4)
        if ($rawUrl -like '/bespoxai/update-config*' -and $req.HttpMethod -eq 'POST') {
            $incomingKey = $req.Headers['X-BespoxAI-Key']
            if ($incomingKey -ne $ApiKey) { $res.StatusCode = 401; $res.Close(); continue }
            try {
                $bodyStr = Read-RequestBody $req
                $newCfg  = $bodyStr | ConvertFrom-Json

                # Read current config into a hashtable so we can merge
                $cfgObj  = Get-Content $ConfigPath -Raw | ConvertFrom-Json
                $cfgHash = @{}
                $cfgObj.PSObject.Properties | ForEach-Object { $cfgHash[$_.Name] = $_.Value }

                # Fields we allow the portal to update (no credentials)
                $updatable = @('bcBaseUrl','bcInstance','bcCompany','bcPort','agentPort',
                               'navDatabaseServer','navDatabaseName','navServerInstance','navManagementPort',
                               'testNavDatabaseServer','testNavDatabaseName','testNavServerInstance',
                               'testBcInstance','testBcCompany','testBcPort','testNavManagementPort')

                foreach ($f in $updatable) {
                    $val = $newCfg.$f
                    if ($null -ne $val -and $val -ne '') { $cfgHash[$f] = $val }
                }

                $cfgHash | ConvertTo-Json -Depth 5 | Out-File -FilePath $ConfigPath -Encoding UTF8 -Force

                # Update in-memory variables so changes take effect immediately
                if ($newCfg.bcBaseUrl)             { $BCBase            = $newCfg.bcBaseUrl }
                if ($newCfg.navDatabaseServer)      { $NavDbServer        = $newCfg.navDatabaseServer }
                if ($newCfg.navDatabaseName)        { $NavDbName          = $newCfg.navDatabaseName }
                if ($newCfg.navServerInstance)      { $NavServerInst      = $newCfg.navServerInstance }
                if ($newCfg.navManagementPort)      { $NavMgmtPort        = $newCfg.navManagementPort }
                if ($newCfg.testNavDatabaseServer)  { $TestNavDbServer    = $newCfg.testNavDatabaseServer }
                if ($newCfg.testNavDatabaseName)    { $TestNavDbName      = $newCfg.testNavDatabaseName }
                if ($newCfg.testNavServerInstance)  { $TestNavServerInst  = $newCfg.testNavServerInstance }
                if ($newCfg.testBcInstance)         { $TestBcInstance     = $newCfg.testBcInstance }
                if ($newCfg.testBcCompany)          { $TestBcCompany      = $newCfg.testBcCompany }
                if ($newCfg.testBcPort)             { $TestBcPort         = $newCfg.testBcPort }
                if ($newCfg.testNavManagementPort)  { $TestNavMgmtPort    = $newCfg.testNavManagementPort }

                # Log only fields that actually changed
                $changed = @()
                foreach ($f in $updatable) {
                    $oldVal = "$($cfgObj.$f)"; $newVal = "$($cfgHash[$f])"
                    if ($oldVal -ne $newVal) { $changed += ($f + ': ' + $oldVal + ' -> ' + $newVal) }
                }
                if ($changed.Count -gt 0) {
                    Write-Log ("Config synced. Changes: " + ($changed -join ' | '))
                } else {
                    Write-Log "Config sync received — no changes detected"
                }
                $rb = [System.Text.Encoding]::UTF8.GetBytes('{"success":true}')
                $res.StatusCode = 200; $res.ContentType = 'application/json'
                $res.ContentLength64 = $rb.Length; $res.OutputStream.Write($rb, 0, $rb.Length)
            } catch {
                Write-Log "update-config ERROR: $_"
                $em = ($_.ToString() -replace '"',"'") -replace '[\r\n]+',' '
                $eb = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$em`"}")
                $res.StatusCode = 500; $res.ContentType = 'application/json'
                $res.ContentLength64 = $eb.Length; $res.OutputStream.Write($eb, 0, $eb.Length)
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

        # Forward with NTLM via HttpWebRequest (WinHTTP-backed, reliable NTLM on Windows Server)
        # HttpClient/.NET NTLM has known handshake issues with NAV/BC -- HttpWebRequest does not.
        $webReq = [System.Net.HttpWebRequest]::Create($targetUrl)
        $webReq.Method      = $req.HttpMethod
        $webReq.UseDefaultCredentials = $true  # uses the BC user Windows token (process runs as BCUser)
        $webReq.Accept      = 'application/json'
        $webReq.Headers.Add('Accept-Encoding', 'identity')
        $webReq.Timeout     = 60000
        $webReq.PreAuthenticate = $false

        # v2.2: Forward request body for POST/PATCH/PUT
        if ($req.HttpMethod -notin @('GET','HEAD','OPTIONS')) {
            if ($req.ContentLength64 -gt 0) {
                $bodyBytes = New-Object byte[] $req.ContentLength64
                $offset = 0; $bLen = $req.ContentLength64; while ($offset -lt $bLen) { $read = $req.InputStream.Read($bodyBytes, $offset, $bLen - $offset); if ($read -le 0) { break }; $offset += $read }
                $webReq.ContentType   = if ($req.ContentType) { $req.ContentType } else { 'application/json' }
                $webReq.ContentLength = $offset
                $reqStream = $webReq.GetRequestStream()
                $reqStream.Write($bodyBytes, 0, $offset)
                $reqStream.Close()
            }
        }

        $statusCode = 200
        $ct         = 'application/json'
        $bytes      = @()
        try {
            $webRes     = $webReq.GetResponse()
            $statusCode = [int]$webRes.StatusCode
            $ct         = if ($webRes.ContentType) { $webRes.ContentType } else { 'application/json' }
            $stream     = $webRes.GetResponseStream()
            $ms         = [System.IO.MemoryStream]::new()
            $stream.CopyTo($ms)
            $bytes      = $ms.ToArray()
            $stream.Close()
            $webRes.Close()
        } catch [System.Net.WebException] {
            $errRes = $_.Exception.Response
            if ($errRes) {
                $statusCode = [int]$errRes.StatusCode
                $ct         = if ($errRes.ContentType) { $errRes.ContentType } else { 'application/json' }
                $stream     = $errRes.GetResponseStream()
                $ms         = [System.IO.MemoryStream]::new()
                $stream.CopyTo($ms)
                $bytes      = $ms.ToArray()
                $stream.Close()
                $errRes.Close()
            } else { throw }
        }

        Write-Log "<- $statusCode ($($bytes.Length) bytes)"

        $res.StatusCode      = $statusCode
        $res.ContentType     = $ct
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
        $res.Close()

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
Write-OK "$BrandName agent script written to $AgentScript"

# ── Step 5: Write agent.config.json ───────────────────────────────────────────

Write-Step 'Writing agent configuration'

$Config = [ordered]@{
    apiKey                = $ApiKey
    listenPort            = $AgentPort
    bcBaseUrl             = "http://localhost:$BCPort/$BCInstance"
    bcPort                = $BCPort
    agentPort             = $AgentPort
    bcUsername            = $BCUsername
    bcPassword            = $BCPassword
    bcInstance            = $BCInstance
    bcCompany             = $BCCompany
    navDatabaseServer     = $NavDatabaseServer
    navDatabaseName       = $NavDatabaseName
    navServerInstance     = $NavServerInstance
    navManagementPort     = $NavManagementPort
    testNavDatabaseServer = $TestNavDatabaseServer
    testNavDatabaseName   = $TestNavDatabaseName
    testNavServerInstance = $TestNavServerInstance
    testBcInstance        = $TestBcInstance
    testBcCompany         = $TestBcCompany
    testBcPort            = $TestBcPort
    testNavManagementPort = $TestNavManagementPort
    version               = $AgentVersion
    installedAt           = (Get-Date -Format 'o')
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
    $ErrorActionPreference = 'Continue'
    & $CloudflaredExe service uninstall 2>&1 | Out-Null
    $ErrorActionPreference = 'Stop'
    Start-Sleep -Seconds 2
    Write-Host ' done.'
}

# Remove stale event log registry key left by prior installs — cloudflared exits 1
# if this key already exists, even though the service itself installs successfully.
$cfEvtKey = 'HKLM:\SYSTEM\CurrentControlSet\Services\EventLog\Application\Cloudflared'
if (Test-Path $cfEvtKey) {
    Remove-Item -Path $cfEvtKey -Force -ErrorAction SilentlyContinue
    Write-Host '    Removed stale Cloudflared event log registry key'
}

# Install tunnel with token
# cloudflared writes INFO logs to stderr; temporarily allow non-terminating errors
# so that $ErrorActionPreference = 'Stop' does not throw a NativeCommandError.
# We verify success by checking whether the service was created, not by exit code alone.
$ErrorActionPreference = 'Continue'
& $CloudflaredExe service install $TunnelToken 2>&1 | ForEach-Object { Write-Host "    $_" }
$cfExitCode = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
Start-Sleep -Seconds 2

$cfSvc = Get-Service -Name 'cloudflared' -ErrorAction SilentlyContinue
if (-not $cfSvc) {
    Write-Fail "cloudflared service was not created (exit code $cfExitCode) -- check the tunnel token and try again"
}

# Force HTTP/2 protocol -- QUIC (UDP) is commonly blocked for the SYSTEM service account
# in corporate environments. HTTP/2 over TCP port 7844 is reliable in all tested configs.
$cfSvcPath = (Get-WmiObject Win32_Service -Filter "Name='cloudflared'").PathName
if ($cfSvcPath -notlike '*--protocol*') {
    $cfNewPath = $cfSvcPath -replace '(cloudflared\.exe)\s+tunnel', '$1 --protocol http2 tunnel'
    & sc.exe config cloudflared binPath= $cfNewPath 2>&1 | Out-Null
    Write-Host '    Patched cloudflared service to use HTTP/2 (TCP) -- avoids QUIC/UDP blocks on SYSTEM account'
}
Write-OK 'cloudflared service installed'

# Configure service recovery -- auto-restart cloudflared if it crashes or drops
& sc.exe failure cloudflared reset= 86400 actions= restart/5000/restart/10000/restart/30000 2>&1 | Out-Null
Write-Host '    Service recovery configured (auto-restart on failure)'

# ── Step 7: Install BCAgent as a scheduled task ────────────────────────────────

Write-Step "Installing $BrandName agent scheduled task"

$TaskName = "$BrandName-BCAgent"

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

# Step 1: Register as SYSTEM (always resolves, no domain lookup required)
$Principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask `
    -TaskName  $TaskName `
    -Action    $Action `
    -Trigger   $Trigger `
    -Settings  $Settings `
    -Principal $Principal `
    -Force | Out-Null

# Step 2: Switch to BC user account via schtasks.exe
# Register-ScheduledTask -User/-Password fails to resolve domain accounts in some
# elevated contexts. schtasks.exe handles domain SID resolution reliably.
$stResult = & schtasks.exe /change /tn $TaskName /ru $BCUsername /rp $BCPassword 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "    Warning: could not set task user ($stResult) -- running as SYSTEM" -ForegroundColor Yellow
    Write-Host "    $BrandName agent will use explicit credentials from agent.config.json instead" -ForegroundColor Yellow
} else {
    Write-OK "Task user set to $BCUsername"
}

Write-OK "Scheduled task '$TaskName' created (runs as $BCUsername at startup)"

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
Write-OK "$BrandName agent started"

# ── Step 9: Health check ───────────────────────────────────────────────────────

Write-Step "Verifying $BrandName agent health"

$maxAttempts = 6
$healthy     = $false

for ($i = 1; $i -le $maxAttempts; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:$AgentPort/health" `
            -Headers @{ 'X-BespoxAI-Key' = $ApiKey } `
            -UseBasicParsing -TimeoutSec 5
        if ($resp.StatusCode -eq 200) { $healthy = $true; break }
    } catch {}
    Write-Host "    Waiting for $BrandName agent... (attempt $i/$maxAttempts)"
    Start-Sleep -Seconds 3
}

if ($healthy) {
    Write-OK "$BrandName agent health check passed — http://localhost:$AgentPort/health"
} else {
    Write-Host ''
    Write-Host "    ⚠ $BrandName agent did not respond in time. It may still be starting." -ForegroundColor Yellow
    Write-Host "      Check the log at: $LogDir\agent.log" -ForegroundColor Yellow
}

# ── Step 8: Configure RDP support account ──────────────────────────────────────

Write-Step "Configuring $BrandName remote support account"

if ($SupportAccountPassword -ne '') {
    $SupportUser = "$BrandName-Support"
    $secPwd = ConvertTo-SecureString $SupportAccountPassword -AsPlainText -Force

    # Create or update the account
    $existingUser = Get-LocalUser -Name $SupportUser -ErrorAction SilentlyContinue
    if ($existingUser) {
        Set-LocalUser -Name $SupportUser -Password $secPwd -PasswordNeverExpires $true
        Write-OK "$BrandName-Support account updated"
    } else {
        New-LocalUser -Name $SupportUser -Password $secPwd `
            -FullName "$BrandName Support" `
            -Description "$BrandName remote support account — do not delete" `
            -PasswordNeverExpires `
            -ErrorAction Stop | Out-Null
        Write-OK "$BrandName-Support account created"
    }

    # Add to Remote Desktop Users
    Add-LocalGroupMember -Group 'Remote Desktop Users' -Member $SupportUser -ErrorAction SilentlyContinue
    Write-OK 'Added to Remote Desktop Users group'

    # Add to Administrators (required for deployment troubleshooting)
    Add-LocalGroupMember -Group 'Administrators' -Member $SupportUser -ErrorAction SilentlyContinue
    Write-OK 'Added to Administrators group'

    # Enable RDP on this machine
    Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' `
        -Name 'fDenyTSConnections' -Value 0 -ErrorAction SilentlyContinue
    Enable-NetFirewallRule -DisplayGroup 'Remote Desktop' -ErrorAction SilentlyContinue
    Write-OK 'RDP enabled (port 3389)'
} else {
    Write-Host '    Skipped — no support account password provided' -ForegroundColor Yellow
}

# ── Done ───────────────────────────────────────────────────────────────────────

Write-Host ''
Write-Host '  ╔══════════════════════════════════════════════╗' -ForegroundColor Green
Write-Host '  ║         Installation Complete  ✓             ║' -ForegroundColor Green
Write-Host '  ╚══════════════════════════════════════════════╝' -ForegroundColor Green
Write-Host ''
Write-Host '  Services installed:' -ForegroundColor White
Write-Host "    • cloudflared    — Windows Service  (auto-start)"
Write-Host "    • $BrandName agent v$AgentVersion   — Scheduled Task   (auto-start at boot)"
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
