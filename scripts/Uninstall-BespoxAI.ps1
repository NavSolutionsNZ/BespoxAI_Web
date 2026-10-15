#Requires -RunAsAdministrator
#Requires -Version 5.1
<#
.SYNOPSIS
    BespoxAI Cleanup / Uninstaller
    Removes all traces of a previous BCAgent installation so a fresh
    install can proceed without port conflicts or stale config.

.DESCRIPTION
    Removes in order:
      0. If a full object export was interrupted, restore the customer's own
         BC licence first (stops here, removing nothing, if that fails)
      1. Stop + unregister BespoxAI-BCAgent scheduled task
      2. Stop + uninstall cloudflared Windows service
      3. Kill any orphaned BCAgent / export worker PowerShell processes
      4. Release port 9099 (or custom) if still held
      5. Remove the <Brand>-Support remote support account (a local
         Administrator the installer creates when the customer consented to RDP)
      6. Remove every BespoxAI_ web service the installer published in BC
      7. Remove the agent account's 'Log on as a batch job' right, if the
         installer granted it (3.13+ records this)
      8. Remove C:\<Brand> directory tree (preserves Deployments/Regression
         by default -- pass -RemoveData to wipe everything)

    Deliberately left alone: RDP and firewall settings (the customer's IT may
    rely on them) and the agent account itself (it belongs to the customer).

.PARAMETER AgentPort
    Port the agent was listening on. Default: 9099
    Used to find and kill any process still holding the port.

.PARAMETER BrandName
    Brand the agent was installed under. Default: BespoxAI. White-label
    installs use the partner's agent brand name, which determines the install
    folder (C:\<Brand>), the task (<Brand>-BCAgent) and the support account
    (<Brand>-Support).

.PARAMETER ServerInstance
    Business Central server instance to remove the BespoxAI_ web services from.
    Default: read from the agent's configuration.

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
    # White-label install under a partner brand
    .\Uninstall-BespoxAI.ps1 -BrandName Endeavour

.EXAMPLE
    # Agent was on a custom port
    .\Uninstall-BespoxAI.ps1 -AgentPort 8081
#>

[CmdletBinding()]
param(
    [int]    $AgentPort      = 9099,
    [string] $BrandName      = 'BespoxAI',
    [string] $ServerInstance = '',
    [switch] $RemoveData
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$InstallRoot    = "C:\$BrandName"
$TaskName       = "$BrandName-BCAgent"
$SupportUser    = "$BrandName-Support"
$CloudflaredExe = "$InstallRoot\Cloudflared\cloudflared.exe"
$AgentDir       = "$InstallRoot\Agent"
$LicenceBackup  = "$AgentDir\LicenceBackup\licence-backup.json"

function Write-Step { param($msg) Write-Host "`n  -> $msg" -ForegroundColor Cyan }
function Write-OK   { param($msg) Write-Host "    OK  $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "    !!  $msg" -ForegroundColor Yellow }
function Write-Info { param($msg) Write-Host "    ... $msg" -ForegroundColor Gray }

Write-Host ''
Write-Host '  ============================================' -ForegroundColor DarkRed
Write-Host "    $BrandName Cleanup / Uninstaller"          -ForegroundColor DarkRed
Write-Host '    Removes the agent, its services, its web'  -ForegroundColor DarkRed
Write-Host '    services in BC and its files'              -ForegroundColor DarkRed
Write-Host '  ============================================' -ForegroundColor DarkRed
Write-Host ''

# Read what the install recorded before its files are removed.
$agentCfg = $null; $installState = $null
try { $agentCfg     = Get-Content "$AgentDir\agent.config.json" -Raw -ErrorAction Stop | ConvertFrom-Json } catch {}
try { $installState = Get-Content "$AgentDir\install-state.json" -Raw -ErrorAction Stop | ConvertFrom-Json } catch {}

# -- Step 0: Restore the customer licence if an export was interrupted ---------
# During a full object export the agent swaps a developer licence into the BC
# database and restores the customer's own afterwards. If an export died
# mid-swap, the backup file below holds the customer's licence. Only the agent
# account can read it and restore it, so let the agent do its startup recovery
# before anything is removed. Never delete the backup without a restore.

if (Test-Path $LicenceBackup) {
    Write-Step 'Restoring the customer licence from an interrupted export'
    Get-WmiObject Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like '*FullExportWorker.ps1*' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Info "Stopped export worker PID $($_.ProcessId)" }
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask  -TaskName $TaskName -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue   # the agent restores at startup
        for ($i = 0; $i -lt 30 -and (Test-Path $LicenceBackup); $i++) { Start-Sleep -Seconds 2 }
    }
    if (Test-Path $LicenceBackup) {
        Write-Host ''
        Write-Host "    The customer's BC licence could not be restored automatically." -ForegroundColor Red
        Write-Host "    Nothing has been removed. Do NOT delete $LicenceBackup -- it holds the original licence." -ForegroundColor Red
        Write-Host "    Check $InstallRoot\Logs\full-export.log, then contact BespoxAI support." -ForegroundColor Red
        exit 1
    }
    Write-OK 'Customer licence restored'
}

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

# Remove stale event log registry key so reinstalls do not fail with exit code 1
$cfEvtKey = 'HKLM:\SYSTEM\CurrentControlSet\Services\EventLog\Application\Cloudflared'
if (Test-Path $cfEvtKey) {
    Remove-Item -Path $cfEvtKey -Force -ErrorAction SilentlyContinue
    Write-OK 'Cloudflared event log registry key removed'
}

# -- Step 3: Kill any orphaned BCAgent PowerShell processes --------------------

Write-Step 'Killing any orphaned BCAgent processes'

$killed = 0

$bcProcs = Get-WmiObject Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*BCAgent.ps1*' -or $_.CommandLine -like '*FullExportWorker.ps1*' }

foreach ($proc in $bcProcs) {
    try {
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
        Write-OK "Killed process PID $($proc.ProcessId)"
        $killed++
    } catch {
        Write-Warn "Could not kill PID $($proc.ProcessId): $_"
    }
}

if ($killed -eq 0) { Write-Warn 'No BCAgent processes found -- skipping' }

# -- Step 4: Release port if still held ---------------------------------------

Write-Step "Clearing HTTP.sys reservation for port $AgentPort"

# HttpListener registers with HTTP.sys (PID 4 / System) -- cannot be killed.
# Must remove the URL ACL reservation via netsh instead.
try {
    $urlacls = & netsh http show urlacl 2>&1 | Select-String "http://\+:$AgentPort/"
    if ($urlacls) {
        foreach ($entry in $urlacls) {
            $url = ($entry.ToString().Trim() -split '\s+')[-1]
            Write-Info "Removing HTTP.sys reservation: $url"
            & netsh http delete urlacl url=$url 2>&1 | ForEach-Object { Write-Info $_ }
        }
        Write-OK "HTTP.sys URL reservations removed for port $AgentPort"
    } else {
        Write-OK "No HTTP.sys reservation found for port $AgentPort"
    }
} catch {
    Write-Warn "Could not clear HTTP.sys reservations: $_"
}

Write-Step "Checking port $AgentPort for other processes"

try {
    $netstatOut = & netstat -ano 2>&1
    $netstatLines = $netstatOut | Where-Object { $_ -match ":$AgentPort\s" }
    if ($netstatLines) {
        foreach ($line in $netstatLines) {
            $parts = ($line.ToString().Trim()) -split '\s+'
            $pidStr = $parts[-1]
            if ($pidStr -eq '4') {
                # PID 4 is the Windows kernel (System) -- never kill it.
                # The netsh urlacl step above should have cleared the HTTP.sys
                # reservation. If it still shows here, a reboot will fully release it.
                Write-Warn "Port $AgentPort still shows PID 4 (HTTP.sys kernel). The netsh step should have cleared it -- if it persists, a reboot will release it. Safe to continue install."
            } elseif ($pidStr -match '^\d+$' -and [int]$pidStr -gt 4) {
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

# -- Step 5: Remove the remote support account --------------------------------
# RDP and firewall settings are deliberately left alone: the customer's own IT
# may rely on them.

Write-Step "Removing remote support account $SupportUser"

if (Get-LocalUser -Name $SupportUser -ErrorAction SilentlyContinue) {
    Remove-LocalUser -Name $SupportUser -ErrorAction SilentlyContinue
    if (Get-LocalUser -Name $SupportUser -ErrorAction SilentlyContinue) {
        Write-Warn "Could not remove $SupportUser -- please delete it manually"
    } else {
        Write-OK "$SupportUser account removed"
    }
} else {
    Write-Warn "$SupportUser account not found -- skipping"
}

# -- Step 6: Remove BespoxAI web services --------------------------------------
# The installer publishes standard pages under BespoxAI_ names (dashboards and
# CFO Assistant). The prefix is ours, so every BespoxAI_ service is removed;
# the customer's own web services are never touched.

Write-Step 'Removing BespoxAI web services from Business Central'

$wsInstance = $ServerInstance
if (-not $wsInstance -and $agentCfg) {
    $wsInstance = if ($agentCfg.PSObject.Properties['navServerInstance'] -and $agentCfg.navServerInstance) { $agentCfg.navServerInstance }
                  elseif ($agentCfg.PSObject.Properties['bcInstance']) { $agentCfg.bcInstance } else { '' }
}
if (-not $wsInstance) {
    Write-Warn 'Business Central server instance unknown -- rerun with -ServerInstance <name> to remove the BespoxAI_ web services'
} else {
    $adminTool = @(
        'C:\Program Files\Microsoft Dynamics 365 Business Central\*\Service\NavAdminTool.ps1',
        'C:\Program Files (x86)\Microsoft Dynamics 365 Business Central\*\Service\NavAdminTool.ps1',
        'C:\Program Files\Microsoft Dynamics NAV\*\Service\NavAdminTool.ps1',
        'C:\Program Files (x86)\Microsoft Dynamics NAV\*\Service\NavAdminTool.ps1'
    ) | ForEach-Object { Get-Item -Path $_ -ErrorAction SilentlyContinue } |
        Sort-Object { $_.Directory.Parent.Name } -Descending | Select-Object -First 1
    if ($adminTool) { . $adminTool.FullName | Out-Null }

    if (-not (Get-Command Remove-NAVWebService -ErrorAction SilentlyContinue)) {
        Write-Warn "NAV administration cmdlets not found -- remove the BespoxAI_ web services manually (Web Services page in $wsInstance)"
    } else {
        try {
            $ours = @(Get-NAVWebService -ServerInstance $wsInstance -ErrorAction Stop | Where-Object { $_.ServiceName -like 'BespoxAI_*' })
            $rmForce = (Get-Command Remove-NAVWebService).Parameters.ContainsKey('Force')
            foreach ($ws in $ours) {
                try {
                    $rmArgs = @{ ServerInstance = $wsInstance; ServiceName = $ws.ServiceName; ObjectType = $ws.ObjectType; ErrorAction = 'Stop' }
                    if ($rmForce) { $rmArgs.Force = $true }
                    Remove-NAVWebService @rmArgs -Confirm:$false
                    Write-OK "Removed web service $($ws.ServiceName)"
                } catch {
                    Write-Warn "Could not remove web service $($ws.ServiceName): $($_.Exception.Message)"
                }
            }
            if ($ours.Count -eq 0) { Write-OK "No BespoxAI_ web services found in $wsInstance" }
        } catch {
            Write-Warn "Could not list web services in ${wsInstance}: $($_.Exception.Message)"
        }
    }
}

# -- Step 7: Remove the batch-logon right the installer granted ---------------

Write-Step "Removing the agent account's 'Log on as a batch job' right"

if ($installState -and $installState.PSObject.Properties['batchLogonGrantedByInstaller'] -and $installState.batchLogonGrantedByInstaller -and $installState.runAsSid) {
    $sidEntry = "*$($installState.runAsSid)"
    $exportInf = Join-Path $env:TEMP "bespoxai-rights-$PID.inf"
    & secedit.exe /export /cfg $exportInf /areas USER_RIGHTS /quiet | Out-Null
    $line = Get-Content $exportInf -ErrorAction SilentlyContinue | Where-Object { $_ -match '^\s*SeBatchLogonRight\s*=' }
    Remove-Item $exportInf -Force -ErrorAction SilentlyContinue
    $holders = @()
    if ($line) { $holders = @((($line -split '=', 2)[1] -split ',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }
    if ($holders -contains $sidEntry) {
        $keep   = @($holders | Where-Object { $_ -ne $sidEntry })
        $cfgInf = Join-Path $env:TEMP "bespoxai-batch-$PID.inf"
        $cfgDb  = Join-Path $env:TEMP "bespoxai-batch-$PID.sdb"
        @('[Unicode]', 'Unicode=yes', '[Version]', 'signature="$CHICAGO$"', 'Revision=1',
          '[Privilege Rights]', ('SeBatchLogonRight = ' + ($keep -join ','))) |
            Set-Content -Path $cfgInf -Encoding Unicode
        & secedit.exe /configure /db $cfgDb /cfg $cfgInf /areas USER_RIGHTS /quiet | Out-Null
        Remove-Item $cfgInf, $cfgDb -Force -ErrorAction SilentlyContinue
        Write-OK "Removed 'Log on as a batch job' from $($installState.runAs)"
    } else {
        Write-OK "$($installState.runAs) no longer has 'Log on as a batch job' -- nothing to remove"
    }
} elseif ($installState) {
    Write-OK 'The agent account already had this right before BespoxAI was installed -- left in place'
} else {
    Write-Warn "No install record (installed before 3.13) -- if the agent account doesn't need 'Log on as a batch job' for anything else, remove it in Local Security Policy"
}

# -- Step 8: Remove install directory -----------------------------------------

Write-Step "Removing $BrandName files"

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

# -- Step 9: Final port verification ------------------------------------------

Write-Step 'Final port verification'

$portInUse = netstat -ano 2>&1 | Select-String ":$AgentPort\s"
if ($portInUse) {
    Write-Warn "Port $AgentPort is STILL in use -- check with: netstat -ano | findstr :$AgentPort"
} else {
    Write-OK "Port $AgentPort is clear -- ready for fresh install"
}

# -- Summary ------------------------------------------------------------------

Write-Host ''
Write-Host '  ============================================' -ForegroundColor Green
Write-Host '    Cleanup Complete'                          -ForegroundColor Green
Write-Host '  ============================================' -ForegroundColor Green
Write-Host ''
Write-Host '  Removed:' -ForegroundColor White
Write-Host "    - Scheduled task  : $TaskName"
Write-Host "    - Support account : $SupportUser"
Write-Host "    - Windows service : cloudflared"
Write-Host "    - Web services    : BespoxAI_* in Business Central"
Write-Host "    - Batch logon     : removed if the installer granted it"
Write-Host "    - BCAgent files   : $InstallRoot\Agent, \Cloudflared, \Logs"
if ($RemoveData) {
    Write-Host "    - Snapshot data   : $InstallRoot\Deployments, \Regression"
} else {
    Write-Host "    - Preserved       : $InstallRoot\Deployments + \Regression (C/AL snapshots)"
}
Write-Host ''
Write-Host '  Server is ready for a fresh BCAgent install.' -ForegroundColor Green
Write-Host ''
