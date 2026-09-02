[CmdletBinding(DefaultParameterSetName = 'Slug')]
param(
    [Parameter(Mandatory = $true, ParameterSetName = 'Slug')] [ValidatePattern('^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$')] [string] $Slug,
    [Parameter(Mandatory = $true, ParameterSetName = 'Ipa')] [string] $Ipa,
    [string] $ReleaseRoot = $env:APPLE_APP_FACTORY_RELEASE_ROOT,
    [string] $ChecksumPath,
    [string] $SideloadlyPath = $env:APPLE_APP_FACTORY_SIDELOADLY_PATH
)

$ErrorActionPreference = 'Stop'
if ($PSCmdlet.ParameterSetName -eq 'Slug') {
    if ([string]::IsNullOrWhiteSpace($ReleaseRoot)) {
        $repositoryRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')
        $ReleaseRoot = Join-Path $repositoryRoot 'data\apple-app-factory\releases'
    }
    $release = Resolve-Path -LiteralPath (Join-Path $ReleaseRoot $Slug)
    $ipaPath = Join-Path $release 'latest.ipa'
    if ([string]::IsNullOrWhiteSpace($ChecksumPath)) { $ChecksumPath = Join-Path $release 'sha256.txt' }
} else {
    $ipaPath = Resolve-Path -LiteralPath $Ipa
    if ([string]::IsNullOrWhiteSpace($ChecksumPath)) { $ChecksumPath = Join-Path (Split-Path -Parent $ipaPath) 'sha256.txt' }
}
$manifestPath = Join-Path (Split-Path -Parent $ipaPath) 'manifest.json'
if (-not (Test-Path -LiteralPath $ipaPath)) { throw "IPA was not found: $ipaPath" }
if (-not (Test-Path -LiteralPath $ChecksumPath)) { throw "Checksum file was not found: $ChecksumPath" }
$ipaNamePattern = [regex]::Escape((Split-Path -Leaf $ipaPath))
$checksumLine = Get-Content -LiteralPath $ChecksumPath | Where-Object { $_ -match "^\s*([A-Fa-f0-9]{64})\s+\*?$ipaNamePattern\s*$" } | Select-Object -First 1
if (-not $checksumLine) { throw "sha256.txt does not contain a SHA-256 record for $(Split-Path -Leaf $ipaPath)." }
$expected = (($checksumLine -split '\s+')[0]).ToLowerInvariant()
$actual = (Get-FileHash -LiteralPath $ipaPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw 'SHA-256 verification failed. Do not open this IPA in Sideloadly.' }

Start-Process explorer.exe -ArgumentList "/select,`"$ipaPath`""

if ([string]::IsNullOrWhiteSpace($SideloadlyPath)) {
    $candidates = @(
        (Join-Path $env:ProgramFiles 'Sideloadly\Sideloadly.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Sideloadly\Sideloadly.exe')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
    $SideloadlyPath = $candidates | Select-Object -First 1
}
if (-not $SideloadlyPath -or -not (Test-Path -LiteralPath $SideloadlyPath)) {
    throw 'Sideloadly.exe was not found. Install it, then set APPLE_APP_FACTORY_SIDELOADLY_PATH locally (never commit it).'
}

# Sideloadly has no supported command-line automation contract. Deliberately do
# not pass an IPA, Apple Account, password, or two-factor code to it. Explorer
# selects the verified file and Sideloadly opens its normal GUI for the one final click.
Start-Process -FilePath $SideloadlyPath
if (Test-Path -LiteralPath $manifestPath) {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $releaseLabel = "$($manifest.app.name) $($manifest.app.version) ($($manifest.app.build))"
} else { $releaseLabel = (Split-Path -Leaf $ipaPath) }
Write-Host "Verified ${releaseLabel}: $actual"
Write-Host 'In Sideloadly: drag the selected IPA into the app, choose your connected iPhone, then complete Apple-required sign-in and click Start.'
Write-Host 'This launcher never supplies Apple credentials and cannot bypass trust, Developer Mode, or seven-day renewal prompts.'
