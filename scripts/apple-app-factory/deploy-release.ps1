[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$')][string]$Slug,
  [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$')][string]$Version,
  [Parameter(Mandatory = $true)][string]$ReleaseRoot
)

$ErrorActionPreference = 'Stop'
$hostName = $env:APPLE_APP_FACTORY_DEPLOY_HOST
$userName = $env:APPLE_APP_FACTORY_DEPLOY_USER
$remoteRoot = $env:APPLE_APP_FACTORY_DEPLOY_ROOT
$keyPath = $env:APPLE_APP_FACTORY_DEPLOY_SSH_KEY_PATH
if ([string]::IsNullOrWhiteSpace($hostName) -or [string]::IsNullOrWhiteSpace($userName) -or [string]::IsNullOrWhiteSpace($remoteRoot) -or [string]::IsNullOrWhiteSpace($keyPath)) {
  throw 'Deployment is disabled until APPLE_APP_FACTORY_DEPLOY_HOST, _USER, _ROOT, and _SSH_KEY_PATH are supplied through the environment.'
}
if (-not (Test-Path -LiteralPath $keyPath -PathType Leaf)) { throw 'Configured SSH key path does not exist.' }
$verify = Join-Path $PSScriptRoot 'verify-release.mjs'
& node $verify --release-root $ReleaseRoot --slug $Slug --version $Version
if ($LASTEXITCODE -ne 0) { throw 'Local release verification failed; nothing was uploaded.' }

# This intentionally uploads only an immutable version directory. Promotion to
# latest is a separate server-side publish operation after verification; a copy
# or network failure cannot replace the working latest release.
$releaseDirectory = Join-Path (Join-Path (Join-Path $ReleaseRoot $Slug) 'releases') $Version
$remoteDestination = "$userName@$hostName`:$remoteRoot/$Slug/releases/"
& scp -i $keyPath -r -- $releaseDirectory $remoteDestination
if ($LASTEXITCODE -ne 0) { throw 'Immutable release upload failed. The previous latest release was not changed.' }
Write-Host 'Immutable release uploaded. Run the authenticated server-side promotion only after remote checksum verification.'
