[CmdletBinding()]
param([string]$ExpectedSid = '')
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ($ExpectedSid -and $identity.User.Value -ne $ExpectedSid) { throw 'Use the original Windows account for elevation.' }
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $child = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Normal -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'), '-ExpectedSid', $identity.User.Value) -Wait -PassThru
    exit $child.ExitCode
}
$migrationRoot = 'C:\BigTuna-Migration'
$kit = Join-Path $migrationRoot 'BigTuna-Mac-Migration.zip'
if (-not (Test-Path -LiteralPath $kit -PathType Leaf)) { throw 'The Mac kit has not been assembled yet.' }
$route = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1
if (-not $route) { throw 'No home network route was found.' }
$networkProfile = Get-NetConnectionProfile -InterfaceIndex $route.InterfaceIndex -ErrorAction Stop
if ($networkProfile.NetworkCategory -ne 'Private') { throw 'Set this trusted home Wi-Fi connection to Private in Windows Settings, then run Start-Download.cmd again. The download firewall rule only permits your local subnet on Private networks.' }
$hostAddress = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex | Where-Object { $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress
if (-not $hostAddress) { throw 'No home network IPv4 address was found.' }
$node = (Get-Command node.exe -ErrorAction Stop).Source
$ruleName = 'BigTunaMigrationDownload-' + [guid]::NewGuid().ToString('N')
Write-Host 'This serves only the encrypted Mac kit and final encrypted export on your home network.'
Write-Host 'No recovery key is downloadable. Keep this window open while the Mac downloads.'
try {
    New-NetFirewallRule -Name $ruleName -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8765 -LocalAddress $hostAddress -RemoteAddress LocalSubnet -Profile Private -Program $node | Out-Null
    & $node (Join-Path $PSScriptRoot 'download-server.cjs') $hostAddress $migrationRoot
    if ($LASTEXITCODE -ne 0) { throw 'Download server stopped with an error.' }
} finally {
    Remove-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
}
