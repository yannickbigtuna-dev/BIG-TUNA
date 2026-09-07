[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$App = 'big-tuna-lights'
)

$ErrorActionPreference = 'Stop'
$RepoRoot = 'C:\SERVER'
$RegistryPath = Join-Path $RepoRoot 'config\apple-apps.json'
$AllowedAppsRoot = 'C:\APPS'
$SourcePath = Join-Path $RepoRoot 'docs\openapi.yaml'

function Get-NormalizedPath([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { throw "$Label does not exist or is not a directory: $Path" }
    (Resolve-Path -LiteralPath $Path).Path.TrimEnd([char[]]@('\', '/'))
}

$appsRoot = Get-NormalizedPath $AllowedAppsRoot 'Allowed app-workspace root'
$registry = Get-Content -LiteralPath $RegistryPath -Raw | ConvertFrom-Json
if ($registry.schemaVersion -ne 1) { throw 'Registry must use schemaVersion 1.' }
$entry = @($registry.apps | Where-Object { $_.slug -eq $App })
if ($entry.Count -ne 1) { throw "Registry must contain exactly one entry for: $App" }
$workspace = Get-NormalizedPath ([string]$entry[0].workspacePath) "Workspace for $App"
if (-not $workspace.StartsWith($appsRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Workspace is outside ${AllowedAppsRoot}: $workspace"
}
if (-not (Test-Path -LiteralPath (Join-Path $workspace '.git'))) { throw "Workspace is not a Git worktree: $workspace" }
if (-not (Test-Path -LiteralPath $SourcePath -PathType Leaf)) { throw "Source contract is missing: $SourcePath" }

$destination = Join-Path $workspace 'SERVER-OPENAPI.generated.yaml'
$header = "# GENERATED COPY -- do not edit. Source: C:\SERVER\docs\openapi.yaml`r`n"
$content = $header + (Get-Content -LiteralPath $SourcePath -Raw)
if ($PSCmdlet.ShouldProcess($destination, 'Copy marked server OpenAPI contract')) {
    [System.IO.File]::WriteAllText($destination, $content, [System.Text.UTF8Encoding]::new($false))
    Write-Host "Wrote generated contract: $destination" -ForegroundColor Green
} else {
    Write-Host "Would write generated contract: $destination" -ForegroundColor Yellow
}
