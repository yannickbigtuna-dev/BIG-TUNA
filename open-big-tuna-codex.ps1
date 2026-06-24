$ErrorActionPreference = "Stop"

$RepoPath = "C:\BIG-TUNA"

if (!(Test-Path $RepoPath)) {
    Write-Host "BIG-TUNA repo not found at $RepoPath" -ForegroundColor Red
    pause
    exit 1
}

$Codex = Get-Command codex -ErrorAction SilentlyContinue
if (!$Codex) {
    Write-Host "Codex CLI was not found on PATH." -ForegroundColor Red
    Write-Host "Open a new terminal after installing Codex, or add codex to PATH." -ForegroundColor Yellow
    pause
    exit 1
}

Set-Location $RepoPath

Write-Host "Opening BIG-TUNA Codex workflow..." -ForegroundColor Cyan
Write-Host "Pulling latest changes..." -ForegroundColor Cyan

git pull origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "git pull failed. Fix the Git error above before starting Codex." -ForegroundColor Red
    pause
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Starting Codex inside BIG-TUNA with full repo permissions..." -ForegroundColor Green
Write-Host "This allows Codex to commit and push. Only use this for repos you trust." -ForegroundColor Yellow
Write-Host ""

codex --cd $RepoPath --sandbox danger-full-access --ask-for-approval never
