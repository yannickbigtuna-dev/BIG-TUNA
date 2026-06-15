$ErrorActionPreference = 'Continue'

$root = 'C:\SERVER'
$pm2 = Join-Path $env:APPDATA 'npm\pm2.cmd'
if (-not (Test-Path $pm2)) {
    $pm2 = 'pm2.cmd'
}

function Get-OllamaExecutable {
    $command = Get-Command ollama -CommandType Application -ErrorAction SilentlyContinue
    if ($command) {
        foreach ($candidate in @($command.Path, $command.Definition)) {
            if ($candidate -and (Test-Path $candidate)) {
                return $candidate
            }
        }
    }

    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'),
        (Join-Path $env:ProgramFiles 'Ollama\ollama.exe')
    )

    if (-not [string]::IsNullOrWhiteSpace(${env:ProgramFiles(x86)})) {
        $candidates += (Join-Path ${env:ProgramFiles(x86)} 'Ollama\ollama.exe')
    }

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate)) {
            return $candidate
        }
    }

    return $null
}

function Test-OllamaApi {
    try {
        $null = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function Start-OllamaApiIfNeeded {
    $ollamaExe = Get-OllamaExecutable
    if (-not $ollamaExe) {
        Write-Host 'Ollama is not installed yet; skipping Eco AI startup.'
        return
    }

    if (Test-OllamaApi) {
        Write-Host 'Ollama API is already running.'
        return
    }

    if (Get-Process -Name 'ollama' -ErrorAction SilentlyContinue) {
        Write-Host 'Ollama is already starting in the background.'
        return
    }

    Write-Host 'Starting Ollama API in the background'
    Start-Process -FilePath $ollamaExe -ArgumentList 'serve' -WindowStyle Hidden | Out-Null
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

Start-OllamaApiIfNeeded
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
