$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptRoot = Split-Path -Parent $PSCommandPath
$manifestPath = Join-Path $scriptRoot 'eco-ai-models.txt'
$ollamaDefaultBaseUri = [Uri]'http://127.0.0.1:11434'

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
        (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'),
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

function Test-OllamaApi {
    try {
        $null = Invoke-RestMethod -Uri ($ollamaDefaultBaseUri.AbsoluteUri.TrimEnd('/') + '/api/tags') -TimeoutSec 2 -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function Wait-OllamaApi {
    param(
        [int]$Seconds = 60
    )

    for ($i = 0; $i -lt $Seconds; $i++) {
        if (Test-OllamaApi) {
            return $true
        }
        Start-Sleep -Seconds 1
    }

    return $false
}

function Start-OllamaApiIfNeeded {
    param(
        [Parameter(Mandatory = $true)][string]$Executable
    )

    if (Test-OllamaApi) {
        Write-Host 'Ollama API is already available.'
        return
    }

    $existing = Get-Process -Name 'ollama' -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host 'Ollama is already running. Waiting for the API to come up.'
        if (-not (Wait-OllamaApi -Seconds 60)) {
            throw "Ollama is running, but its API did not become ready at $ollamaDefaultBaseUri."
        }
        return
    }

    Write-Host "Starting Ollama API with $Executable"
    Start-Process -FilePath $Executable -ArgumentList 'serve' -WindowStyle Hidden | Out-Null

    if (-not (Wait-OllamaApi -Seconds 60)) {
        throw "Ollama API did not become ready at $ollamaDefaultBaseUri."
    }
}

function Get-ManifestModels {
    if (-not (Test-Path $manifestPath)) {
        throw "Manifest not found: $manifestPath"
    }

    $seen = @{}
    $models = New-Object System.Collections.Generic.List[string]

    foreach ($rawLine in Get-Content -LiteralPath $manifestPath) {
        $line = ($rawLine -replace '\s*[#;].*$', '').Trim()
        if (-not $line) {
            continue
        }

        if (-not $seen.ContainsKey($line)) {
            $seen[$line] = $true
            [void]$models.Add($line)
        }
    }

    return $models
}

function Invoke-OllamaPull {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][string]$Model
    )

    Write-Host "Pulling model: $Model"
    & $Executable pull $Model
    if ($LASTEXITCODE -ne 0) {
        throw "ollama pull failed for $Model with exit code $LASTEXITCODE"
    }
}

Write-Host ''
Write-Host '=== Eco AI Ollama maintenance ==='
Write-Host ''

$ollamaExe = Get-OllamaExecutable
if (-not $ollamaExe) {
    throw 'Ollama was not found. Install it before running maintenance.'
}

Write-Host "Using Ollama at $ollamaExe"
Start-OllamaApiIfNeeded -Executable $ollamaExe

$models = Get-ManifestModels
foreach ($model in $models) {
    Invoke-OllamaPull -Executable $ollamaExe -Model $model
}

Write-Host ''
Write-Host 'Eco AI model maintenance complete.'
