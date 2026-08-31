$ErrorActionPreference = 'Continue'

$root = 'C:\SERVER'
$pm2 = Join-Path $env:APPDATA 'npm\pm2.cmd'
if (-not (Test-Path $pm2)) {
    $pm2 = 'pm2.cmd'
}

$ollamaBackend = 'cpu_avx2'
$ollamaBackendChanged = [Environment]::GetEnvironmentVariable('OLLAMA_LLM_LIBRARY', 'User') -ne $ollamaBackend
if ($ollamaBackendChanged) {
    [Environment]::SetEnvironmentVariable('OLLAMA_LLM_LIBRARY', $ollamaBackend, 'User')
}
$env:OLLAMA_LLM_LIBRARY = $ollamaBackend

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
        $null = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function Start-OllamaApiIfNeeded {
    $ollamaExe = Get-OllamaExecutable
    if (-not $ollamaExe) {
        Write-Host 'Ollama is not installed yet; skipping Eco AI startup.'
        return
    }

    if ((Test-OllamaApi) -and -not $ollamaBackendChanged) {
        Write-Host 'Ollama API is already running.'
        return
    }

    if (Get-Process -Name 'ollama' -ErrorAction SilentlyContinue) {
        Write-Host 'Restarting Ollama on the required CPU backend.'
        Get-Process -Name 'ollama' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }

    Write-Host 'Starting Ollama API in the background'
    Start-Process -FilePath $ollamaExe -ArgumentList 'serve' -WindowStyle Hidden | Out-Null
}

function Get-ActiveWifiSsid {
    param(
        [Parameter(Mandatory = $true)]$Adapter
    )

    try {
        # NetConnectionProfile.Name is Windows' NLM display name, which may not
        # match the Wi-Fi SSID. Read the SSID from netsh and keep it scoped to
        # the connected adapter so another Wi-Fi interface cannot be trusted.
        $netshOutput = @(& netsh.exe wlan show interfaces 2>$null)
        if ($LASTEXITCODE -ne 0 -or $netshOutput.Count -eq 0) {
            return $null
        }

        $interfaceBlocks = @()
        $currentBlock = @()
        foreach ($line in $netshOutput) {
            if ($line -match '^\s*Name\s*:') {
                if ($currentBlock.Count -gt 0) {
                    $interfaceBlocks += ,$currentBlock
                }
                $currentBlock = @()
            }

            if ($currentBlock.Count -gt 0 -or $line -match '^\s*Name\s*:') {
                $currentBlock += [string]$line
            }
        }
        if ($currentBlock.Count -gt 0) {
            $interfaceBlocks += ,$currentBlock
        }

        foreach ($interfaceBlock in $interfaceBlocks) {
            $interfaceName = $null
            foreach ($line in $interfaceBlock) {
                $nameMatch = [regex]::Match([string]$line, '^\s*Name\s*:\s*(?<name>.+?)\s*$', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
                if ($nameMatch.Success) {
                    $interfaceName = $nameMatch.Groups['name'].Value.Trim()
                    break
                }
            }

            if ([string]::IsNullOrWhiteSpace($interfaceName) -or $interfaceName -ine $Adapter.Name) {
                continue
            }

            foreach ($line in $interfaceBlock) {
                # Anchor this to SSID so the BSSID line is never mistaken for it.
                $ssidMatch = [regex]::Match([string]$line, '^\s*SSID\s*:\s*(?<ssid>.+?)\s*$', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
                if ($ssidMatch.Success) {
                    $ssid = $ssidMatch.Groups['ssid'].Value.Trim()
                    if (-not [string]::IsNullOrWhiteSpace($ssid)) {
                        return $ssid
                    }
                }
            }
        }
    } catch {
        Write-Host "HomeKit LAN setup: could not determine active Wi-Fi SSID: $($_.Exception.Message)"
    }

    return $null
}

function Initialize-HomeKitLanAccess {
    $homeKitDirectory = Join-Path $root 'data\lights\homekit'
    $homeKitNetworkFile = Join-Path $homeKitDirectory 'homekit-network.json'

    try {
        New-Item -ItemType Directory -Path $homeKitDirectory -Force -ErrorAction Stop | Out-Null

        $storedSsid = $null
        $legacyProfileName = $null
        if (Test-Path $homeKitNetworkFile) {
            $storedNetwork = Get-Content -Raw -Path $homeKitNetworkFile -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
            if ($storedNetwork.ssid -is [string] -and -not [string]::IsNullOrWhiteSpace($storedNetwork.ssid)) {
                $storedSsid = $storedNetwork.ssid
            } elseif ($storedNetwork.profileName -is [string] -and -not [string]::IsNullOrWhiteSpace($storedNetwork.profileName)) {
                $legacyProfileName = $storedNetwork.profileName
            } else {
                Write-Host 'HomeKit LAN setup: stored network marker is invalid; leaving network category unchanged.'
            }
        }

        $activeWifi = Get-NetAdapter -Physical -ErrorAction Stop | Where-Object {
            $_.Status -eq 'Up' -and ($_.NdisPhysicalMedium -eq '802.11' -or $_.MediaType -eq 'Native 802.11')
        } | Select-Object -First 1
        $activeProfile = if ($activeWifi) {
            Get-NetConnectionProfile -InterfaceIndex $activeWifi.ifIndex -ErrorAction Stop | Where-Object {
                $_.IPv4Connectivity -eq 'Internet' -or $_.IPv6Connectivity -eq 'Internet'
            } | Select-Object -First 1
        }
        $activeWifiSsid = if ($activeWifi) {
            Get-ActiveWifiSsid -Adapter $activeWifi
        }

        if ($storedSsid) {
            if ($activeProfile -and $activeWifiSsid -ceq $storedSsid -and $activeProfile.NetworkCategory -ne 'Private') {
                Set-NetConnectionProfile -InterfaceIndex $activeProfile.InterfaceIndex -NetworkCategory Private -ErrorAction Stop
                Write-Host "HomeKit LAN setup: set stored Wi-Fi SSID '$storedSsid' to Private."
            }
        } elseif ($legacyProfileName) {
            if ($activeProfile -and $activeWifiSsid -and $activeProfile.Name -ceq $legacyProfileName) {
                if ($activeProfile.NetworkCategory -ne 'Private') {
                    Set-NetConnectionProfile -InterfaceIndex $activeProfile.InterfaceIndex -NetworkCategory Private -ErrorAction Stop
                }
                @{ ssid = $activeWifiSsid } | ConvertTo-Json | Set-Content -Path $homeKitNetworkFile -Encoding UTF8 -ErrorAction Stop
                Write-Host "HomeKit LAN setup: migrated trusted Wi-Fi marker to SSID '$activeWifiSsid'."
            } else {
                Write-Host 'HomeKit LAN setup: legacy Wi-Fi marker does not match the active connection; leaving network category unchanged.'
            }
        } elseif (-not (Test-Path $homeKitNetworkFile)) {

            if ($activeProfile -and -not [string]::IsNullOrWhiteSpace($activeWifiSsid)) {
                if ($activeProfile.NetworkCategory -ne 'Private') {
                    Set-NetConnectionProfile -InterfaceIndex $activeProfile.InterfaceIndex -NetworkCategory Private -ErrorAction Stop
                }
                @{ ssid = $activeWifiSsid } | ConvertTo-Json | Set-Content -Path $homeKitNetworkFile -Encoding UTF8 -ErrorAction Stop
                Write-Host "HomeKit LAN setup: trusted Wi-Fi SSID '$activeWifiSsid' is Private."
            } else {
                Write-Host 'HomeKit LAN setup: no Internet-connected Wi-Fi SSID found; leaving network category unchanged.'
            }
        }
    } catch {
        Write-Host "HomeKit LAN setup network error: $($_.Exception.Message)"
    }

    try {
        $homeKitRules = @(
            @{ DisplayName = 'BIG TUNA HomeKit TCP (Private LAN)'; Protocol = 'TCP'; LocalPort = 51826 },
            @{ DisplayName = 'BIG TUNA HomeKit mDNS (Private LAN)'; Protocol = 'UDP'; LocalPort = 5353 }
        )

        foreach ($ruleDefinition in $homeKitRules) {
            $rules = @(Get-NetFirewallRule -DisplayName $ruleDefinition.DisplayName -ErrorAction SilentlyContinue)
            if ($rules.Count -eq 0) {
                New-NetFirewallRule -DisplayName $ruleDefinition.DisplayName -Direction Inbound -Action Allow -Enabled True -Profile Private -Protocol $ruleDefinition.Protocol -LocalPort $ruleDefinition.LocalPort -RemoteAddress LocalSubnet -ErrorAction Stop | Out-Null
            } else {
                $rules | Set-NetFirewallRule -Direction Inbound -Action Allow -Enabled True -Profile Private -ErrorAction Stop
                $rules | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol $ruleDefinition.Protocol -LocalPort $ruleDefinition.LocalPort -ErrorAction Stop
                $rules | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -RemoteAddress LocalSubnet -ErrorAction Stop
            }
        }
        Write-Host 'HomeKit LAN firewall rules are enabled for the Private local subnet.'
    } catch {
        Write-Host "HomeKit LAN setup firewall error: $($_.Exception.Message)"
    }
}

function Invoke-Pm2App {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string[]]$StartArgs,
        [Parameter(Mandatory = $true)][string[]]$RestartArgs
    )

    & $pm2 describe $Name *> $null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Restarting PM2 app: $Name"
        & $pm2 @RestartArgs
    } else {
        Write-Host "Starting PM2 app: $Name"
        & $pm2 @StartArgs
    }
}

Set-Location $root

Write-Host ''
Write-Host '=== BIG TUNA startup ==='
Write-Host ''

Start-OllamaApiIfNeeded
Initialize-HomeKitLanAccess
Invoke-Pm2App -Name 'apps-server' -StartArgs @('start', 'C:\SERVER\ecosystem.config.cjs', '--update-env') -RestartArgs @('restart', 'C:\SERVER\ecosystem.config.cjs', '--only', 'apps-server', '--update-env')
Invoke-Pm2App -Name 'mcp-server' -StartArgs @('start', 'C:\SERVER\mcp-server\ecosystem.config.cjs') -RestartArgs @('restart', 'mcp-server')

Write-Host 'Saving PM2 process list'
& $pm2 save

$cloudflared = Get-Process -Name 'cloudflared' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq 'C:\SERVER\cloudflared.exe' }
if ($cloudflared) {
    Write-Host 'Cloudflare Tunnel is already running'
} else {
    Write-Host 'Starting Cloudflare Tunnel'
    Start-Process -FilePath 'C:\SERVER\cloudflared.exe' -ArgumentList @('tunnel', '--config', 'C:\SERVER\cloudflared-config.yml', 'run') -WindowStyle Minimized
}

$updaterRunning = $false
try {
    $updaterRunning = [bool](Get-CimInstance Win32_Process | Where-Object {
        $_.CommandLine -like '*C:\SERVER\auto-update.ps1*' -and
        $_.CommandLine -notlike '*Get-CimInstance Win32_Process*'
    })
} catch {
    Write-Host 'Could not inspect PowerShell command lines; starting the git reloader anyway'
}

if ($updaterRunning) {
    Write-Host 'Git reloader is already running'
} else {
    Write-Host 'Starting git reloader'
    Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'C:\SERVER\auto-update.ps1') -WindowStyle Hidden
}

Write-Host ''
Write-Host 'Current PM2 status:'
& $pm2 status

Write-Host ''
Write-Host 'Startup complete.'
Write-Host 'Main site: https://yannickmorgans.ca'
Write-Host 'MCP URL:   https://mcp.yannickmorgans.ca/mcp'
