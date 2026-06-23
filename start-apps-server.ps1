# Starts (or restarts) the main app server with the secrets from server.env.
# Use this when pm2 is not installed — it loads server.env into the environment
# and launches `node server.js`, after stopping anything already on port 3000.
#
#   1. copy server.env.example -> server.env  and fill in your keys
#   2. right-click this file -> Run with PowerShell   (or:  powershell -ExecutionPolicy Bypass -File start-apps-server.ps1)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

# --- stop any server already listening on port 3000 ---
$conns = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
foreach ($c in $conns) {
    try { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue; Write-Host "Stopped old server (PID $($c.OwningProcess))" } catch {}
}

# --- load server.env (KEY=VALUE, # comments allowed) ---
$envFile = Join-Path $root 'server.env'
if (-not (Test-Path $envFile)) {
    Write-Warning "server.env not found. Copy server.env.example to server.env and fill it in."
    Write-Warning "Starting WITHOUT AI coaching / email until you do."
} else {
    foreach ($line in Get-Content $envFile) {
        $t = $line.Trim()
        if (-not $t -or $t.StartsWith('#')) { continue }
        $i = $t.IndexOf('=')
        if ($i -lt 1) { continue }
        $k = $t.Substring(0, $i).Trim()
        $v = $t.Substring($i + 1).Trim().Trim('"').Trim("'")
        if ($k) { Set-Item -Path "Env:$k" -Value $v }
    }
    Write-Host "Loaded server.env"
}

# --- resolve node ---
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }

Write-Host "Starting app server on http://localhost:3000 ..."
# Launch detached so it keeps running after this window closes; logs to apps-server.log
Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $root `
    -RedirectStandardOutput (Join-Path $root 'apps-server.out.log') `
    -RedirectStandardError  (Join-Path $root 'apps-server.err.log') `
    -WindowStyle Hidden

Start-Sleep -Seconds 2
$ok = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($ok) { Write-Host "App server is up on :3000" } else { Write-Warning "Did not see :3000 listening yet — check apps-server.err.log" }
