cd C:\SERVER

while ($true) {
    Write-Host "Checking GitHub for updates..."

    git fetch origin main

    $local = git rev-parse HEAD
    $remote = git rev-parse origin/main

    if ($local -ne $remote) {
        Write-Host "Update found. Pulling changes..."
        git pull origin main
        Write-Host "Updated."
    } else {
        Write-Host "No updates."
    }

    Start-Sleep -Seconds 10
}
