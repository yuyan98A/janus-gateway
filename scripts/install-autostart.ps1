# Windows Background Autostart & Daemon Guard Installer for Agent Model Gateway
# Configures the gateway to automatically launch silently on boot/logon without a console window.

$ErrorActionPreference = 'Stop'
$rootDir = (Resolve-Path "$PSScriptRoot\..").Path
$vbsScript = Join-Path $rootDir "scripts\start-hidden.vbs"
$psScript = Join-Path $rootDir "scripts\service-start.ps1"
$taskName = "AgentModelGatewayDaemon"

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "⚙️ Installing Agent Model Gateway Windows Background Autostart" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan

# 1. Universal User Startup Folder Registration (Zero-Admin, 100% Reliable)
$startupDir = [Environment]::GetFolderPath('Startup')
$startupVbs = Join-Path $startupDir "AgentModelGateway.vbs"

$startupVbsContent = @"
' Agent Model Gateway Silent Background Autostart Launcher
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "$rootDir"
cmd = "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -NoProfile -File """ & "$psScript" & """"
WshShell.Run cmd, 0, False
"@

try {
    [System.IO.File]::WriteAllText($startupVbs, $startupVbsContent, [System.Text.Encoding]::ASCII)
    Write-Host "✔ User Startup Autostart script created successfully:" -ForegroundColor Green
    Write-Host "  - Path: $startupVbs"
    Write-Host "  - Mode: Silent logon startup via Windows Shell (No admin rights required)"
} catch {
    Write-Warning "Could not write to Startup folder: $_"
}

# 2. Enhanced Windows Task Scheduler Registration (If elevated / Admin)
$isAdmin = $false
try {
    $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
    $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
} catch {}

if ($isAdmin) {
    try {
        $action = New-ScheduledTaskAction `
            -Execute "wscript.exe" `
            -Argument "`"$vbsScript`"" `
            -WorkingDirectory $rootDir

        $trigger = New-ScheduledTaskTrigger -AtLogOn

        $settings = New-ScheduledTaskSettingsSet `
            -AllowStartIfOnBatteries `
            -DontStopIfGoingOnBatteries `
            -StartWhenAvailable `
            -RestartCount 3 `
            -RestartInterval (New-TimeSpan -Minutes 1) `
            -ExecutionTimeLimit (New-TimeSpan -Days 0)

        $taskPrincipal = New-ScheduledTaskPrincipal `
            -UserId $env:USERNAME `
            -LogonType Interactive

        Register-ScheduledTask `
            -TaskName $taskName `
            -Action $action `
            -Trigger $trigger `
            -Settings $settings `
            -Principal $taskPrincipal `
            -Description "Agent Model Gateway Zero-Downtime Cluster Background Daemon" `
            -Force | Out-Null

        Write-Host "✔ Windows Task Scheduler task '$taskName' registered successfully (Admin mode with failure auto-restart)." -ForegroundColor Green
    } catch {
        Write-Host "• Task Scheduler registration skipped (User Startup Folder is already active)." -ForegroundColor DarkGray
    }
} else {
    Write-Host "• Windows Task Scheduler registration skipped (Non-admin mode; User Startup Folder is active)." -ForegroundColor DarkGray
    Write-Host "  (To also enable Task Scheduler crash-guard, run 'npm run service:install' from an Administrator terminal)."
}

# 3. Start service now if not running
Write-Host "`n• Checking if service is currently running..." -ForegroundColor Cyan
& (Join-Path $rootDir "scripts\service-start.ps1")

Write-Host "`n======================================================================" -ForegroundColor Green
Write-Host "🎉 Background Service & Auto-Start Configured Successfully!" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Green
Write-Host "The gateway is running and will automatically start silently on every boot/logon."
Write-Host "Useful commands:"
Write-Host "  - npm run service:status    : Check service health and live metrics"
Write-Host "  - npm run reload            : Zero-downtime hot reload after code changes"
Write-Host "  - npm run service:stop      : Stop background service"
Write-Host "  - npm run service:restart   : Restart background service"
Write-Host "  - npm run service:uninstall : Remove autostart and delete scheduled task"
Write-Host "======================================================================`n"
