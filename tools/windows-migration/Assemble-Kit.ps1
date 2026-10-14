[CmdletBinding()]
param([string]$MigrationRoot = 'C:\BigTuna-Migration')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$sourceRoot = 'C:\SERVER'
$preview = Join-Path $MigrationRoot 'Preview'
$packageRoot = Join-Path $MigrationRoot 'Package'
$kitRoot = Join-Path $packageRoot 'BigTuna-Mac-Kit'
$zipPath = Join-Path $MigrationRoot 'BigTuna-Mac-Migration.zip'
if (-not (Test-Path -LiteralPath (Join-Path $preview 'inventory.json') -PathType Leaf)) { throw 'Create the preliminary encrypted export under Preview first.' }
if ((Test-Path -LiteralPath $packageRoot) -or (Test-Path -LiteralPath $zipPath)) { throw 'Kit output exists. Preserve it and choose a new migration output location; no overwrite is performed.' }
New-Item -ItemType Directory -Path $kitRoot | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceRoot 'tools\mac-migration') -Destination (Join-Path $MigrationRoot 'mac-source-copy') -Recurse
Get-ChildItem -LiteralPath (Join-Path $MigrationRoot 'mac-source-copy') -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $kitRoot }
Copy-Item -LiteralPath (Join-Path $sourceRoot 'scripts\migration') -Destination (Join-Path $kitRoot 'migration') -Recurse
Copy-Item -LiteralPath (Join-Path $preview 'migration.btm') -Destination $kitRoot
Copy-Item -LiteralPath (Join-Path $preview 'inventory.json') -Destination $kitRoot
Copy-Item -LiteralPath (Join-Path $preview 'migration.btm.sha256') -Destination $kitRoot
Copy-Item -LiteralPath (Join-Path $sourceRoot 'docs\MAC-MIGRATION.md') -Destination (Join-Path $kitRoot 'READ-FIRST.md')
Copy-Item -LiteralPath (Join-Path $sourceRoot 'docs\MAC-MIGRATION.md') -Destination (Join-Path $MigrationRoot 'READ-FIRST.md')
Get-ChildItem -LiteralPath (Join-Path $sourceRoot 'tools\windows-migration') -File | Where-Object { $_.Name -ne 'Assemble-Kit.ps1' } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $MigrationRoot }
$utf8 = [Text.UTF8Encoding]::new($false)
Get-ChildItem -LiteralPath $kitRoot -File -Recurse | Where-Object { $_.Extension -in @('.command', '.sh') } | ForEach-Object {
    $text = [IO.File]::ReadAllText($_.FullName).Replace("`r`n", "`n")
    [IO.File]::WriteAllText($_.FullName, $text, $utf8)
}
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = [IO.File]::Open($zipPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
$archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in Get-ChildItem -LiteralPath $kitRoot -Recurse -File) {
        $entryName = 'BigTuna-Mac-Kit/' + $file.FullName.Substring($kitRoot.Length + 1).Replace('\', '/')
        if ($entryName -match 'RECOVERY-KEY|\.key$|server\.env|token\.txt|pm2-dump') { throw 'A private plaintext file was selected for the kit. Refusing assembly.' }
        $compression = if ($file.Extension -eq '.btm') { [IO.Compression.CompressionLevel]::NoCompression } else { [IO.Compression.CompressionLevel]::Optimal }
        $entry = $archive.CreateEntry($entryName, $compression)
        $entry.ExternalAttributes = [Convert]::ToInt32($(if ($file.Extension -in @('.command', '.sh')) { '100755' } else { '100644' }), 8) -shl 16
        $entryStream = $entry.Open()
        $inputStream = [IO.File]::OpenRead($file.FullName)
        try { $inputStream.CopyTo($entryStream) } finally { $inputStream.Dispose(); $entryStream.Dispose() }
    }
} finally { $archive.Dispose(); $stream.Dispose() }
& node.exe (Join-Path $PSScriptRoot 'zip-metadata.cjs') $zipPath
if ($LASTEXITCODE -ne 0) { throw 'ZIP executable metadata validation failed.' }
$sha = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText($zipPath + '.sha256', $sha + '  BigTuna-Mac-Migration.zip' + "`n", $utf8)
Write-Host "Mac kit: $zipPath"
Write-Host "Zip SHA-256: $sha"
Write-Host 'Recovery key is separate under Preview. Run Start-Download.cmd to transfer the encrypted kit on the home LAN.'
