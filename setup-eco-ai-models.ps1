$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptRoot = Split-Path -Parent $PSCommandPath
$manifestPath = Join-Path $scriptRoot 'eco-ai-models.txt'
$maintainScript = Join-Path $scriptRoot 'maintain-eco-ai-models.ps1'
$ollamaDefaultInstall = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
$taskName = 'BIG TUNA - Eco AI Model Maintenance'
$taskDescription = 'Keeps Ollama running and pulls the Eco AI model manifest.'

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
        $ollamaDefaultInstall,
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

function Install-OllamaIfNeeded {
    if (Get-OllamaExecutable) {
        Write-Host 'Ollama is already installed.'
        return
    }

    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw 'winget was not found. Install winget before running this setup script.'
    }

    Write-Host 'Installing Ollama with winget...'
    winget install --id Ollama.Ollama -e --silent --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "winget install failed with exit code $LASTEXITCODE"
    }

    if (-not (Get-OllamaExecutable)) {
        throw 'Ollama installation finished, but the executable was not found.'
    }
}

function Register-MaintenanceTask {
    $powershellExe = (Get-Process -Id $PID).Path
    if (-not $powershellExe) {
        $hostCommand = Get-Command pwsh.exe, powershell.exe -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($hostCommand) {
            $powershellExe = $hostCommand.Path
        }
    }

    if (-not $powershellExe) {
        throw 'Could not locate the current PowerShell executable for the scheduled task.'
    }

    $action = New-ScheduledTaskAction -Execute $powershellExe -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$maintainScript`"" -WorkingDirectory $scriptRoot
    $trigger = New-ScheduledTaskTrigger -Daily -At 7:00AM
    $principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew

    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description $taskDescription -Force | Out-Null
}

Write-Host ''
Write-Host '=== BIG TUNA Eco AI setup ==='
Write-Host ''

if (-not (Test-Path $manifestPath)) {
    throw "Manifest not found: $manifestPath"
}

Install-OllamaIfNeeded

Write-Host 'Running maintenance immediately...'
& $maintainScript

Write-Host 'Registering scheduled task...'
Register-MaintenanceTask

Write-Host ''
Write-Host 'Eco AI Ollama setup complete.'
