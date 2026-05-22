#Requires -RunAsAdministrator
#Requires -Version 5.1
<#
.SYNOPSIS
    BespoxAI Cleanup / Uninstaller
    Removes all traces of a previous BCAgent installation so a fresh
    install can proceed without port conflicts or stale config.

.DESCRIPTION
    Removes in order:
      1. Stop + unregister BespoxAI-BCAgent scheduled task
      2. Stop + uninstall cloudflared Windows service
      3. Kill any orphaned BCAgent PowerShell processes
      4. Release port 8080 (or custom) if still held
      5. Remove C:\BespoxAI directory tree (preserves Deployments/Regression
         by default -- pass -RemoveData to wipe everything)

.PARAMETER AgentPort
    Port the agent was listening on. Default: 8080
    Used to find and kill any process still holding the port.

.PARAMETER RemoveData
    Switch. If specified, also removes C:\BespoxAI\Deployments and
    C:\BespoxAI\Regression (C/AL snapshots). Omit to preserve them
    across reinstalls.

.EXAMPLE
    # Standard clean reinstall -- keeps snapshot data
    .\Uninstall-BespoxAI.ps1

.EXAMPLE
    # Full wipe including all C/AL snapshot data
    .\Uninstall-BespoxAI.ps1 -RemoveData

.EXAMPLE
    # Agent was on a custom port
    .\Uninstall-BespoxAI.ps1 -AgentPort 8081
#>

[CmdletBinding()]
param(
    [int]    $AgentPort  = 8080,
    [switch] $RemoveData
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$InstallRoot    = 'C:\BespoxAI'
$TaskName       = 'BespoxAI-BCAgent'
$CloudflaredExe = "$InstallRoot\Cloudflared\cloudflared.exe"

function Write-Step { param($msg) Write-Host "`n  -> $msg" -ForegroundColor Cyan }
function Write-OK   { param($msg) Write-Host "    OK  $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "    !!  $msg" -ForegroundColor Yellow }
function Write-Info { param($msg) Write-Host "    ... $msg" -ForegroundColor Gray }

Write-Host ''
Write-Host '  ============================================' -ForegroundColor DarkRed
Write-Host '    BespoxAI Cleanup / Uninstaller'            -ForegroundColor DarkRed
Write-Host '    Removes all BCAgent services and files'    -ForegroundColor DarkRed
Write-Host '  ============================================' -ForegroundColor DarkRed
Write-Host ''

# -- Step 1: Stop + unregister BCAgent scheduled task --------------------------

Write-Step 'Removing BCAgent scheduled task'

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    $state = $task.State
    if ($state -eq 'Running') {
        Write-Info 'Task is running -- stopping it...'
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 3
    }
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-OK "Scheduled task '$TaskName' removed (was: $state)"
} else {
    Write-Warn "Scheduled task '$TaskName' not found -- skipping"
}

# -- Step 2: Stop + uninstall cloudflared service ------------------------------

Write-Step 'Removing cloudflared tunnel service'

$cfSvc = Get-Service -Name 'cloudflared' -ErrorAction SilentlyContinue
if ($cfSvc) {
    if ($cfSvc.Status -eq 'Running') {
        Write-Info 'Stopping cloudflared service...'
        Stop-Service -Name 'cloudflared' -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
    if (Test-Path $CloudflaredExe) {
        Write-Info 'Uninstalling via cloudflared.exe...'
        & $CloudflaredExe service uninstall 2>&1 | ForEach-Object { Write-Info $_ }
    } else {
        Write-Info 'cloudflared.exe not found -- removing service via sc.exe...'
        & sc.exe delete cloudflared 2>&1 | Out-Null
    }
    Start-Sleep -Seconds 2
    $cfSvcAfter = Get-Service -Name 'cloudflared' -ErrorAction SilentlyContinue
    if ($cfSvcAfter) {
        Write-Warn 'cloudflared service still present -- may need a reboot to fully clear'
    } else {
        Write-OK 'cloudflared service removed'
    }
} else {
    Write-Warn 'cloudflared service not found -- skipping'
}

# -- Step 3: Kill any orphaned BCAgent PowerShell processes --------------------

Write-Step 'Killing any orphaned BCAgent processes'

$killed = 0

$bcProcs = Get-WmiObject Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*BCAgent.ps1*' }

foreach ($proc in $bcProcs) {
    try {
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
        Write-OK "Killed process PID $($proc.ProcessId) (BCAgent.ps1)"
        $killed++
    } catch {
        Write-Warn "Could not kill PID $($proc.ProcessId): $_"
    }
}

if ($killed -eq 0) { Write-Warn 'No BCAgent processes found -- skipping' }

# -- Step 4: Release port if still held ---------------------------------------

Write-Step "Checking port $AgentPort"

try {
    $netstatOut = & netstat -ano 2>&1
    $netstatLines = $netstatOut | Where-Object { $_ -match ":$AgentPort\s" }
    if ($netstatLines) {
        foreach ($line in $netstatLines) {
            $parts = ($line.ToString().Trim()) -split '\s+'
            $pidStr = $parts[-1]
            if ($pidStr -match '^\d+$' -and [int]$pidStr -gt 0) {
                $proc = Get-Process -Id ([int]$pidStr) -ErrorAction SilentlyContinue
                if ($proc) {
                    Write-Warn "Port $AgentPort held by PID $pidStr ($($proc.Name)) -- killing..."
                    Stop-Process -Id ([int]$pidStr) -Force -ErrorAction SilentlyContinue
                    Start-Sleep -Seconds 1
                    Write-OK "Killed PID $pidStr"
                }
            }
        }
    } else {
        Write-OK "Port $AgentPort is free"
    }
} catch {
    Write-Warn "Could not check port $AgentPort : $_"
}

# -- Step 5: Remove C:\BespoxAI directory -------------------------------------

Write-Step 'Removing BespoxAI files'

if (-not (Test-Path $InstallRoot)) {
    Write-Warn "$InstallRoot not found -- nothing to remove"
} else {
    if ($RemoveData) {
        Write-Info "RemoveData specified -- removing entire $InstallRoot tree"
        Remove-Item $InstallRoot -Recurse -Force -ErrorAction SilentlyContinue
        if (-not (Test-Path $InstallRoot)) {
            Write-OK "Removed $InstallRoot (including all snapshot data)"
        } else {
            Write-Warn "Could not fully remove $InstallRoot -- some files may be locked. Try again or reboot."
        }
    } else {
        $preserve = @('Deployments', 'Regression')
        Write-Info "Preserving snapshot folders: $($preserve -join ', ')"

        Get-ChildItem $InstallRoot -Directory | Where-Object { $_.Name -notin $preserve } | ForEach-Object {
            Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
            Write-OK "Removed $($_.FullName)"
        }

        Get-ChildItem $InstallRoot -File | ForEach-Object {
            Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
            Write-OK "Removed $($_.FullName)"
        }

        Write-OK "BespoxAI install files removed (Deployments + Regression preserved)"
        Write-Info "To also remove snapshot data, rerun with: .\Uninstall-BespoxAI.ps1 -RemoveData"
    }
}

# -- Step 6: Final port verification ------------------------------------------

Write-Step 'Final port verification'

Start-Sleep -Seconds 1
try {
    $tcp = [System.Net.Sockets.TcpClient]::new('localhost', $AgentPort)
    $tcp.Close()
    Write-Warn "Port $AgentPort is STILL in use -- check with: netstat -ano | findstr :$AgentPort"
} catch {
    Write-OK "Port $AgentPort is clear -- ready for fresh install"
}

# -- Summary ------------------------------------------------------------------

Write-Host ''
Write-Host '  ============================================' -ForegroundColor Green
Write-Host '    Cleanup Complete'                          -ForegroundColor Green
Write-Host '  ============================================' -ForegroundColor Green
Write-Host ''
Write-Host '  Removed:' -ForegroundColor White
Write-Host "    - Scheduled task  : BespoxAI-BCAgent"
Write-Host "    - Windows service : cloudflared"
Write-Host "    - BCAgent files   : $InstallRoot\Agent, \Cloudflared, \Logs"
if ($RemoveData) {
    Write-Host "    - Snapshot data   : $InstallRoot\Deployments, \Regression"
} else {
    Write-Host "    - Preserved       : $InstallRoot\Deployments + \Regression (C/AL snapshots)"
}
Write-Host ''
Write-Host '  Server is ready for a fresh BCAgent install.' -ForegroundColor Green
Write-Host ''
