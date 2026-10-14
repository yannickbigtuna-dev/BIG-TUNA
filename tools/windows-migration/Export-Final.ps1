[CmdletBinding()]
param([string]$ExpectedSid = '')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$serverRoot = 'C:\SERVER'
$outputRoot = 'C:\BigTuna-Migration'
$scriptPath = $PSCommandPath
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ($ExpectedSid -and $identity.User.Value -ne $ExpectedSid) { throw 'Use the same Windows account for UAC elevation. Alternate administrator credentials would export the wrong user configuration.' }
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'The final export needs administrator access to stop automatic startup tasks.'
    $elevated = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Normal -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $scriptPath + '"'), '-ExpectedSid', $identity.User.Value) -Wait -PassThru
    exit $elevated.ExitCode
}
Write-Host 'Run this ONLY after the Mac preview passes. This stops the Windows website.'
Write-Host 'Close app editors, device tools, Codex, and other programs writing SERVER/APPS first.'
Write-Host 'Keep this window open. Your website stays offline until Mac Activate.command runs.'
$confirmation = Read-Host 'Type EXPORT FINAL to stop Windows hosting and create the final transfer'
if ($confirmation -cne 'EXPORT FINAL') { throw 'Cancelled. No services were changed.' }
$exportScript = Join-Path $serverRoot 'scripts\migration\export.cjs'
if (-not (Test-Path -LiteralPath $exportScript -PathType Leaf)) { throw 'Migration exporter is missing.' }
$node = (Get-Command node.exe -ErrorAction Stop).Source
$pm2 = (Get-Command pm2.cmd -ErrorAction Stop).Source
$destination = Join-Path $outputRoot ('Final-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
if (-not (Test-Path -LiteralPath $outputRoot -PathType Container)) { New-Item -ItemType Directory -Path $outputRoot -ErrorAction Stop | Out-Null }
if (Test-Path -LiteralPath $destination) { throw 'Final export destination already exists; refusing overwrite.' }
$stateFile = Join-Path $outputRoot 'windows-cutover-state.json'
if (Test-Path -LiteralPath $stateFile) { throw 'A previous cutover state exists. Resolve it with Resume-Windows.cmd before starting another final export.' }
$tasks = @('BigTunaServerStartup', 'BIG TUNA - Eco AI Model Maintenance')
$state = [ordered]@{ createdAt = (Get-Date).ToUniversalTime().ToString('o'); output = $destination; userSid = $identity.User.Value; enabledTasks = @(); startupLinks = @() }
foreach ($name in $tasks) {
    $task = Get-ScheduledTask -TaskName $name -TaskPath '\' -ErrorAction SilentlyContinue
    if ($task -and $task.State -ne 'Disabled') { $state.enabledTasks += $name }
}
foreach ($startupRoot in @([Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('CommonStartup'))) {
    if (-not $startupRoot) { continue }
    $link = Join-Path $startupRoot 'CloudflaredServer.lnk'
    if (Test-Path -LiteralPath $link -PathType Leaf) {
        $quarantine = Join-Path $outputRoot ('disabled-cloudflared-startup-' + $state.startupLinks.Count + '.lnk')
        if (Test-Path -LiteralPath $quarantine) { throw 'A previous quarantined Startup link exists. Resolve the previous migration first.' }
        $state.startupLinks += [ordered]@{ original = $link; quarantine = $quarantine }
    }
}
$state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $stateFile -Encoding UTF8
try {
    foreach ($link in $state.startupLinks) { Move-Item -LiteralPath $link.original -Destination $link.quarantine }
    foreach ($name in $state.enabledTasks) {
        Disable-ScheduledTask -TaskName $name -TaskPath '\' | Out-Null
    }
    $updaterPath = [regex]::Escape((Join-Path $serverRoot 'auto-update.ps1'))
    $maintenancePath = [regex]::Escape((Join-Path $serverRoot 'maintain-eco-ai-models.ps1'))
    $orchestratorPath = [regex]::Escape((Join-Path $serverRoot 'start-everything.ps1'))
    $processSnapshot = @(Get-CimInstance Win32_Process)
    $writerParents = @($processSnapshot | Where-Object {
        $_.ProcessId -ne $PID -and $_.Name -match '^(powershell|pwsh)\.exe$' -and
        ($_.CommandLine -match $updaterPath -or $_.CommandLine -match $maintenancePath -or $_.CommandLine -match $orchestratorPath)
    })
    foreach ($parent in $writerParents) {
        & taskkill.exe /PID $parent.ProcessId /T /F
        if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $parent.ProcessId -ErrorAction SilentlyContinue)) { throw 'Could not stop the scoped server updater process tree.' }
    }
    foreach ($name in $state.enabledTasks) { Stop-ScheduledTask -TaskName $name -TaskPath '\' -ErrorAction SilentlyContinue }
    Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq 'cloudflared.exe' -and $_.ExecutablePath -eq (Join-Path $serverRoot 'cloudflared.exe')
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction Stop }
    $pm2Raw = & $pm2 jlist
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect PM2. Windows services may still be running.' }
    $processes = ($pm2Raw -join "`n") | ConvertFrom-Json
    foreach ($name in @('apps-server', 'mcp-server')) {
        if (@($processes | Where-Object name -eq $name).Count -gt 0) {
            & $pm2 stop $name
            if ($LASTEXITCODE -ne 0) { throw "Failed to stop PM2 app $name" }
        }
    }
    & $pm2 save --force
    if ($LASTEXITCODE -ne 0) { throw 'PM2 save failed.' }
    Start-Sleep -Seconds 2
    foreach ($port in @(3000, 3001)) {
        if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "Port $port still has a writer/server. Resolve before final export." }
    }
    & $node $exportScript --output $destination --final --confirm-stopped --include-codex-history
    if ($LASTEXITCODE -ne 0) { throw 'Final export failed. Windows hosting remains stopped; follow the recovery instruction below.' }
    Write-Host "Final export ready: $destination"
    Write-Host 'Copy the encrypted bundle to the Mac kit folder; enter its NEW recovery key there.'
    Write-Host 'Run Restore.command on the Mac, then Verify.command and Activate.command.'
    Write-Host 'Windows automatic hosting startup is disabled. Keep its files until Mac reboot and backup checks pass.'
} catch {
    Write-Host 'Hosting may be stopped. Do not restart Windows while the Mac is serving production.' -ForegroundColor Yellow
    Write-Host 'If Mac activation has NOT happened, run Resume-Windows.cmd to restore Windows hosting.'
    throw
}
