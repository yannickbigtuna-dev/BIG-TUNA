$ErrorActionPreference = 'Continue'

$root = 'C:\SERVER'
$pm2 = Join-Path $env:APPDATA 'npm\pm2.cmd'
if (-not (Test-Path $pm2)) {
    $pm2 = 'pm2.cmd'
}

function Invoke-Pm2App {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string[]]$StartArgs
    )

    & $pm2 describe $Name *> $null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Restarting PM2 app: $Name"
        & $pm2 restart $Name
    } else {
        Write-Host "Starting PM2 app: $Name"
        & $pm2 @StartArgs
    }
}

Set-Location $root

Write-Host ''
Write-Host '=== BIG TUNA startup ==='
Write-Host ''

Invoke-Pm2App -Name 'apps-server' -StartArgs @('start', 'C:\SERVER\server.js', '--name', 'apps-server', '--watch', 'false')
Invoke-Pm2App -Name 'mcp-server' -StartArgs @('start', 'C:\SERVER\mcp-server\ecosystem.config.cjs')

Write-Host 'Saving PM2 process list'
& $pm2 save

$cloudflared = Get-Process -Name 'cloudflared' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq 'C:\SERVER\cloudflared.exe' }
if ($cloudflared) {
    Write-Host 'Cloudflare Tunnel is already running'
} else {
    Write-Host 'Starting Cloudflare Tunnel'
    Start-Process -FilePath 'C:\SERVER\cloudflared.exe' -ArgumentList @('tunnel', '--config', 'C:\SERVER\cloudflared-config.yml', 'run') -WindowStyle Minimized
}

$updaterRunning = $false
try {
    $updaterRunning = [bool](Get-CimInstance Win32_Process | Where-Object {
        $_.CommandLine -like '*C:\SERVER\auto-update.ps1*' -and
        $_.CommandLine -notlike '*Get-CimInstance Win32_Process*'
    })
} catch {
    Write-Host 'Could not inspect PowerShell command lines; starting the git reloader anyway'
}

if ($updaterRunning) {
    Write-Host 'Git reloader is already running'
} else {
    Write-Host 'Starting git reloader'
    Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'C:\SERVER\auto-update.ps1') -WindowStyle Hidden
}

Write-Host ''
Write-Host 'Current PM2 status:'
& $pm2 status

Write-Host ''
Write-Host 'Startup complete.'
Write-Host 'Main site: https://yannickmorgans.ca'
Write-Host 'MCP URL:   https://mcp.yannickmorgans.ca/mcp'
