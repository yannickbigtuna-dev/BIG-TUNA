[CmdletBinding()]
param([string]$ExpectedSid = '')
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ($ExpectedSid -and $identity.User.Value -ne $ExpectedSid) { throw 'Elevate with the original Windows user account.' }
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $elevated = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Normal -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'), '-ExpectedSid', $identity.User.Value) -Wait -PassThru
    exit $elevated.ExitCode
}
Write-Host 'Use only before Mac activation, or after stopping Mac production.'
Write-Host 'If users have changed data on the Mac, reconcile that data before returning to Windows.'
if ((Read-Host 'Type MAC IS STOPPED to restore Windows hosting') -cne 'MAC IS STOPPED') { throw 'Cancelled.' }
$stateFile = 'C:\BigTuna-Migration\windows-cutover-state.json'
if (Test-Path -LiteralPath $stateFile) {
    $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    if ($state.userSid -ne $identity.User.Value) { throw 'Resume under the Windows user who created the final export.' }
    foreach ($name in $state.enabledTasks) { Enable-ScheduledTask -TaskName $name -TaskPath '\' | Out-Null }
    foreach ($link in $state.startupLinks) {
        if (Test-Path -LiteralPath $link.quarantine -PathType Leaf) {
            if (Test-Path -LiteralPath $link.original) { throw 'The original Startup link path is occupied; refusing overwrite.' }
            Move-Item -LiteralPath $link.quarantine -Destination $link.original
        }
    }
}
& 'C:\SERVER\start-everything.ps1'
$pm2 = (Get-Command pm2.cmd -ErrorAction Stop).Source
Start-Sleep -Seconds 3
$pm2Raw = & $pm2 jlist
if ($LASTEXITCODE -ne 0) { throw 'PM2 inspection failed; cutover marker retained.' }
$processes = ($pm2Raw -join "`n") | ConvertFrom-Json
foreach ($name in @('apps-server', 'mcp-server')) {
    if (-not @($processes | Where-Object { $_.name -eq $name -and $_.pm2_env.status -eq 'online' }).Count) { throw "PM2 app $name is not online; cutover marker retained." }
}
foreach ($port in @(3000, 3001)) {
    if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) { throw "Port $port not listening; cutover marker retained." }
}
$tunnel = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'cloudflared.exe' -and $_.ExecutablePath -eq 'C:\SERVER\cloudflared.exe' })
if (-not $tunnel.Count) { throw 'Windows tunnel is not running; cutover marker retained.' }
if (Test-Path -LiteralPath $stateFile) {
    Move-Item -LiteralPath $stateFile -Destination ('C:\BigTuna-Migration\windows-cutover-state-resumed-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
}
Write-Host 'Check https://yannickmorgans.ca and your lights before resuming normal use.'
