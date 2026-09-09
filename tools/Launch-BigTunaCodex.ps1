[CmdletBinding()]
param(
    [string[]]$App,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$RepoRoot = 'C:\SERVER'
$RegistryPath = Join-Path $RepoRoot 'config\apple-apps.json'
$AllowedAppsRoot = 'C:\APPS'

function Get-NormalizedPath([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "$Label does not exist or is not a directory: $Path"
    }
    return (Resolve-Path -LiteralPath $Path).Path.TrimEnd([char[]]@('\', '/'))
}

function Test-ChildPath([string]$Parent, [string]$Child) {
    $prefix = $Parent + [System.IO.Path]::DirectorySeparatorChar
    return $Child.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
}

try {
    $resolvedRepoRoot = Get-NormalizedPath $RepoRoot 'BIG TUNA server root'
    $resolvedAppsRoot = Get-NormalizedPath $AllowedAppsRoot 'Allowed app-workspace root'
    if ($resolvedRepoRoot -ne $RepoRoot) { throw "Expected server root $RepoRoot, found $resolvedRepoRoot" }
    if (-not (Test-Path -LiteralPath $RegistryPath -PathType Leaf)) { throw "Registry is missing: $RegistryPath" }
    $registry = Get-Content -LiteralPath $RegistryPath -Raw | ConvertFrom-Json
    if ($registry.schemaVersion -ne 1 -or -not $registry.apps) { throw 'Registry must use schemaVersion 1 and contain apps.' }

    $registryEntries = @($registry.apps)
    $requestedSlugs = if ($App -and $App.Count) { @($App) } else { @($registryEntries | ForEach-Object { [string]$_.slug }) }
    if (-not $requestedSlugs.Count) { throw 'The app registry contains no registered applications.' }

    $selected = @()
    foreach ($slug in $requestedSlugs) {
        if ($slug -notmatch '^[a-z0-9][a-z0-9-]{0,63}$') { throw "Invalid app slug: $slug" }
        $entry = @($registryEntries | Where-Object { $_.slug -eq $slug })
        if ($entry.Count -ne 1) { throw "Registry must contain exactly one entry for: $slug" }
        $rawWorkspace = [string]$entry[0].workspacePath
        if (-not (Test-Path -LiteralPath $rawWorkspace -PathType Container)) {
            if ($App -and $App.Count) { throw "Workspace for $slug does not exist or is not a directory: $rawWorkspace" }
            Write-Warning "Skipping registered app $slug because its workspace is missing: $rawWorkspace"
            continue
        }
        $workspace = Get-NormalizedPath $rawWorkspace "Workspace for $slug"
        if (-not (Test-ChildPath $resolvedAppsRoot $workspace)) { throw "Workspace for $slug is outside ${AllowedAppsRoot}: $workspace" }
        $gitDirectory = Join-Path $workspace '.git'
        if (-not (Test-Path -LiteralPath $gitDirectory -PathType Container)) {
            if ($App -and $App.Count) { throw "Workspace for $slug is not a Git worktree: $workspace" }
            Write-Warning "Skipping registered app $slug because it is not a Git worktree: $workspace"
            continue
        }
        $gitDirectory = Get-NormalizedPath $gitDirectory "Git metadata directory for $slug"
        if (-not (Test-ChildPath $workspace $gitDirectory)) { throw "Git metadata directory for $slug is outside its workspace: $gitDirectory" }
        $selected += [pscustomobject]@{ Slug = $slug; Workspace = $workspace; GitDirectory = $gitDirectory }
    }
    if (-not $selected.Count) { throw 'No registered app workspaces are available to add to Codex.' }

    $codex = Get-Command codex -ErrorAction SilentlyContinue
    if (-not $codex) {
        Write-Warning 'Codex CLI was not found on PATH. Install it or open a terminal with codex available.'
        if (-not $DryRun) { exit 1 }
    }

    $arguments = @('--sandbox', 'workspace-write', '-C', $resolvedRepoRoot)
    foreach ($entry in $selected) { $arguments += @('--add-dir', $entry.Workspace, '--add-dir', $entry.GitDirectory) }

    Write-Host 'BIG TUNA Codex workspace:' -ForegroundColor Cyan
    Write-Host "  server: $resolvedRepoRoot"
    foreach ($entry in $selected) {
        Write-Host "  app [$($entry.Slug)]: $($entry.Workspace)"
        Write-Host "    git metadata: $($entry.GitDirectory)"
    }
    Write-Warning 'This launcher uses workspace-write mode: Codex can write only the server workspace, listed app workspaces, and their validated Git metadata directories. Review the dry run before continuing.'
    Write-Host (('codex ' + ($arguments | ForEach-Object { if ($_ -match '[\s]') { '"' + $_ + '"' } else { $_ } }) -join ' ')) -ForegroundColor Yellow

    if ($DryRun) { return }
    & $codex.Source @arguments
    exit $LASTEXITCODE
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
