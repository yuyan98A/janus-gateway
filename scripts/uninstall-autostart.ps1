# Windows Background Autostart Uninstaller for Agent Model Gateway
# Removes the Startup Folder launcher, Windows Task Scheduler task, and stops the background service.

$ErrorActionPreference = 'SilentlyContinue'
$rootDir = (Resolve-Path "$PSScriptRoot\..").Path
$taskName = "AgentModelGatewayDaemon"

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "🗑️ Uninstalling Agent Model Gateway Autostart Configuration" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan

# 1. Remove User Startup Folder Launcher
$startupDir = [Environment]::GetFolderPath('Startup')
$startupVbs = Join-Path $startupDir "AgentModelGateway.vbs"
if (Test-Path $startupVbs) {
    Remove-Item -Path $startupVbs -Force -ErrorAction SilentlyContinue
    Write-Host "✔ User Startup launcher removed: $startupVbs" -ForegroundColor Green
} else {
    Write-Host "• User Startup launcher was not found (already removed)." -ForegroundColor DarkGray
}

# 2. Unregister Scheduled Task (if present)
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false | Out-Null
    Write-Host "✔ Scheduled Task '$taskName' removed from Windows Task Scheduler." -ForegroundColor Green
} else {
    Write-Host "• Scheduled Task '$taskName' was not found (already uninstalled)." -ForegroundColor DarkGray
}

# 3. Stop running service
Write-Host "`n• Stopping background service..." -ForegroundColor Cyan
& (Join-Path $rootDir "scripts\service-stop.ps1")

Write-Host "`n======================================================================" -ForegroundColor Green
Write-Host "✔ Agent Model Gateway Autostart completely uninstalled." -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Green
