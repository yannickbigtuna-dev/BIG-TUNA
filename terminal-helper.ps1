# terminal-helper.ps1
# Run as: powershell.exe -NoLogo -File C:\SERVER\terminal-helper.ps1
# Wraps an interactive PowerShell session with explicit stdout flushing,
# because stdout is block-buffered when piped (not a TTY).

# Force stdout to auto-flush on every write
$sw = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput())
$sw.AutoFlush = $true
[Console]::SetOut($sw)

$ew = New-Object System.IO.StreamWriter([Console]::OpenStandardError())
$ew.AutoFlush = $true
[Console]::SetError($ew)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'
$OutputEncoding        = [System.Text.Encoding]::UTF8

Set-Location C:\SERVER

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $line = $line.TrimEnd("`r")
    if ($line -eq '') { continue }

    try {
        # Run in current scope so Set-Location etc. persist
        $result = Invoke-Expression $line 2>&1
        foreach ($item in $result) {
            if ($item -is [System.Management.Automation.ErrorRecord]) {
                [Console]::Error.WriteLine($item.ToString())
            } else {
                [Console]::WriteLine(($item | Out-String).TrimEnd())
            }
        }
    } catch {
        [Console]::Error.WriteLine($_.ToString())
    }

    [Console]::Out.Flush()
    [Console]::Error.Flush()
}
