cd C:\SERVER

$pm2 = Join-Path $env:APPDATA 'npm\pm2.cmd'
if (-not (Test-Path $pm2)) {
    $pm2 = 'pm2.cmd'
}

function Test-GitAncestor {
    param(
        [Parameter(Mandatory = $true)][string]$Ancestor,
        [Parameter(Mandatory = $true)][string]$Descendant
    )

    git merge-base --is-ancestor $Ancestor $Descendant
    return $LASTEXITCODE -eq 0
}

while ($true) {
    Write-Host "Checking GitHub for updates..."

    git fetch origin main
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Git fetch failed; keeping the current server version."
        Start-Sleep -Seconds 10
        continue
    }

    $local = (git rev-parse HEAD).Trim()
    $remote = (git rev-parse origin/main).Trim()

    if ($local -eq $remote) {
        Write-Host "No updates."
    } elseif (Test-GitAncestor -Ancestor $local -Descendant $remote) {
        Write-Host "Update found. Pulling changes..."
        git pull --ff-only origin main
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Refreshing production dependencies..."
            npm install --omit=dev --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) {
                Write-Host "Production dependency refresh failed; leaving apps-server running its current version."
                Start-Sleep -Seconds 10
                continue
            }
            Write-Host "Restarting apps-server so server.js changes take effect..."
            & $pm2 restart apps-server
            Write-Host "Updated."
        } else {
            Write-Host "Fast-forward pull failed; leaving the running server unchanged."
        }
    } elseif (Test-GitAncestor -Ancestor $remote -Descendant $local) {
        Write-Host "Local main is ahead of origin/main; waiting for it to be pushed."
    } else {
        Write-Host "Local main and origin/main have diverged; manual reconciliation is required."
    }

    Start-Sleep -Seconds 10
}
