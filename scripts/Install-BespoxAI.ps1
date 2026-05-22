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
    [string] $TestNavDatabaseServer = '',
    [string] $TestNavDatabaseName   = '',
    [string] $TestNavServerInstance = '',
    [string] $TestBcInstance        = '',
    [string] $TestBcCompany         = '',
    [int]    $TestBcPort            = 0
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

Write-Step 'Installing BCAgent v2.4'

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
$ListenPort    = if ($Config.listenPort) { $Config.listenPort } else { 9099 }
$ApiKey        = $Config.apiKey
$BCBase        = $Config.bcBaseUrl   # e.g. http://localhost:8048
$BCUser        = $Config.bcUsername
$BCPass        = $Config.bcPassword
$NavDbServer   = if ($Config.navDatabaseServer) { $Config.navDatabaseServer } else { 'localhost' }
$NavDbName     = $Config.navDatabaseName
$NavServerInst       = $Config.navServerInstance
$TestNavDbServer     = if ($Config.testNavDatabaseServer) { $Config.testNavDatabaseServer } else { $NavDbServer }
$TestNavDbName       = $Config.testNavDatabaseName
$TestNavServerInst   = $Config.testNavServerInstance
$TestBcInstance      = $Config.testBcInstance
$TestBcCompany       = $Config.testBcCompany
$TestBcPort          = if ($Config.testBcPort) { $Config.testBcPort } else { 0 }

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
    Write-Log "BCAgent v2.4 started — listening on port $ListenPort"
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
            $body = [System.Text.Encoding]::UTF8.GetBytes("{`"status`":`"$statusMsg`",`"version`":`"2.4`"}")
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
                [void]$req.InputStream.Read($bodyBytes, 0, $bodyLen)
                $body    = [System.Text.Encoding]::UTF8.GetString($bodyBytes) | ConvertFrom-Json
                $objects = $body.objects          # [{filename, content}]
                $requirementId = if ($body.requirementId) { $body.requirementId -replace '[^a-zA-Z0-9_-]','' } else { 'unknown' }
                $timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'

                if (-not $objects -or $objects.Count -eq 0) { throw 'No objects provided.' }

                $deployDir = "C:\BespoxAI\Deployments\$requirementId\${timestamp}_deploy"
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

                $resp = [System.Text.Encoding]::UTF8.GetBytes("{`"snapshotId`":`"${timestamp}_deploy`",`"path`":`"$deployDir`",`"objectCount`":$($objects.Count)}")
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
                [void]$req.InputStream.Read($bodyBytes, 0, $bodyLen)
                $body    = [System.Text.Encoding]::UTF8.GetString($bodyBytes) | ConvertFrom-Json
                $requirementId = if ($body.requirementId) { $body.requirementId -replace '[^a-zA-Z0-9_-]','' } else { 'unknown' }
                $snapshotId    = $body.snapshotId -replace '[^a-zA-Z0-9_-]',''
                $environment   = if ($body.environment) { $body.environment } else { 'test' }

                # Select database based on environment
                if ($environment -eq 'production') {
                    $dbServer = $NavDbServer; $dbName = $NavDbName; $dbInst = $NavServerInst
                } else {
                    $dbServer = $TestNavDbServer; $dbName = $TestNavDbName; $dbInst = $TestNavServerInst
                    if (-not $dbName) { throw "testNavDatabaseName not configured. Add it in the BC Installer tab." }
                }

                $deployDir = "C:\BespoxAI\Deployments\$requirementId\$snapshotId"
                if (-not (Test-Path $deployDir)) { throw "Snapshot folder not found: $deployDir" }

                # Load NAV management module
                $navPaths = @(
                    'C:\Program Files (x86)\Microsoft Dynamics NAV\*\Service\NavAdminTool.ps1',
                    'C:\Program Files\Microsoft Dynamics NAV\*\Service\NavAdminTool.ps1'
                )
                foreach ($pat in $navPaths) {
                    $f = Get-Item -Path $pat -ErrorAction SilentlyContinue | Select-Object -First 1
                    if ($f) { . $f.FullName; break }
                }

                $results = @()
                $txtFiles = Get-ChildItem -Path $deployDir -Filter '*.txt' -File

                foreach ($file in $txtFiles) {
                    $fileResult = @{ filename = $file.Name; imported = $false; compiled = $false; error = '' }
                    try {
                        # Import
                        Import-NAVApplicationObject -DatabaseServer $dbServer -DatabaseName $dbName `
                            -Path $file.FullName -ImportAction Overwrite -SynchronizeSchemaChanges Force `
                            -ErrorAction Stop
                        $fileResult.imported = $true
                        Write-Log "Imported: $($file.Name) → $dbName"

                        # Parse type+id from filename (Type_Id_Name.txt)
                        $parts = $file.BaseName -split '_'
                        if ($parts.Count -ge 2) {
                            $objType = $parts[0]; $objId = $parts[1]
                            $filter = "Type=$objType;Id=$objId"
                            Compile-NAVApplicationObject -DatabaseServer $dbServer -DatabaseName $dbName `
                                -Filter $filter -SynchronizeSchemaChanges Force -ErrorAction Stop
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
                $res.StatusCode = 200; $res.ContentType = 'application/json'
                $res.ContentLength64 = $resp.Length; $res.OutputStream.Write($resp, 0, $resp.Length)
            } catch {
                Write-Log "Deploy ERROR: $_"
                $em = ($_.ToString() -replace '"',"'") -replace '[\r\n]+',' '
                $eb = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$em`"}")
                $res.StatusCode = 500; $res.ContentType = 'application/json'
                $res.ContentLength64 = $eb.Length; $res.OutputStream.Write($eb, 0, $eb.Length)
            }
            $res.Close(); continue
        }

        # BCAgent-local: List regression/deployment snapshots (v2.4)
        if ($rawUrl -like '/bespoxai/objects/snapshots*' -and $req.HttpMethod -eq 'GET') {
            $incomingKey = $req.Headers['X-BespoxAI-Key']
            if ($incomingKey -ne $ApiKey) { $res.StatusCode = 401; $res.Close(); continue }
            try {
                $result = @{ regression = @(); deployments = @() }
                foreach ($tree in @(@{key='regression';path='C:\BespoxAI\Regression'}, @{key='deployments';path='C:\BespoxAI\Deployments'})) {
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
                [void]$req.InputStream.Read($bodyBytes, 0, $bodyLen)
                $body = [System.Text.Encoding]::UTF8.GetString($bodyBytes) | ConvertFrom-Json
                $reqId = if ($body.requirementId) { $body.requirementId -replace '[^a-zA-Z0-9_-]','' } else { '' }
                $deleted = 0
                foreach ($base in @('C:\BespoxAI\Regression','C:\BespoxAI\Deployments')) {
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
                [void]$req.InputStream.Read($bodyBytes, 0, $bodyLen)
                $body    = [System.Text.Encoding]::UTF8.GetString($bodyBytes) | ConvertFrom-Json
                $objects       = $body.objects
                $requirementId = if ($body.requirementId) { $body.requirementId -replace '[^a-zA-Z0-9_-]','' } else { 'unknown' }
                $timestamp     = Get-Date -Format 'yyyyMMdd_HHmmss'

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

                # Save regression snapshot
                $regressionDir = "C:\BespoxAI\Regression\$requirementId\${timestamp}_fetch"
                New-Item -ItemType Directory -Path $regressionDir -Force | Out-Null
                $manifest = @{ requirementId=$requirementId; type='fetch'; timestamp=(Get-Date -Format 'o'); objects=@($objects|ForEach-Object{"$($_.type) $($_.id)"}) } | ConvertTo-Json
                Set-Content -Path "$regressionDir\_manifest.json" -Value $manifest -Encoding UTF8
                if (Test-Path $tempTxt) { Copy-Item $tempTxt -Destination $regressionDir -Force }
                Write-Log "Regression saved: $regressionDir"

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
    version           = '2.4'
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
Write-Host "    • BCAgent v2.4   — Scheduled Task   (auto-start at boot)"
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
