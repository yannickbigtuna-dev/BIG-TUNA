cd C:\SERVER

$pm2 = Join-Path $env:APPDATA 'npm\pm2.cmd'
if (-not (Test-Path $pm2)) {
    $pm2 = 'pm2.cmd'
}

while ($true) {
    Write-Host "Checking GitHub for updates..."

    git fetch origin main

    $local = git rev-parse HEAD
    $remote = git rev-parse origin/main

    if ($local -ne $remote) {
        Write-Host "Update found. Pulling changes..."
        git pull origin main
        Write-Host "Restarting apps-server so server.js changes take effect..."
        & $pm2 restart apps-server
        Write-Host "Updated."
    } else {
        Write-Host "No updates."
    }

    Start-Sleep -Seconds 10
}
