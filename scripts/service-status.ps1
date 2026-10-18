# Windows Background Service Status Checker for Agent Model Gateway
# Displays live process metrics, HTTP health endpoint state, and scheduled task registration.

$rootDir = (Resolve-Path "$PSScriptRoot\..").Path
$pidFile = Join-Path $rootDir "data\gateway.pid"
$logFile = Join-Path $rootDir "logs\service.log"
$errFile = Join-Path $rootDir "logs\service-error.log"

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "📊 Agent Model Gateway Service Status Report" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan

# 1. Process Status
$isRunning = $false
$masterPid = 0
$port = 18763

if (Test-Path $pidFile) {
    try {
        $pidInfo = Get-Content $pidFile -Raw | ConvertFrom-Json
        $masterPid = [int]$pidInfo.pid
        $port = if ($pidInfo.port) { [int]$pidInfo.port } else { 18763 }
        $proc = Get-Process -Id $masterPid -ErrorAction SilentlyContinue
        if ($proc) {
            $isRunning = $true
            $memoryMb = [math]::Round($proc.WorkingSet64 / 1MB, 1)
            $startTimeStr = if ($pidInfo.startTime) { $pidInfo.startTime } else { $proc.StartTime.ToString('yyyy-MM-dd HH:mm:ss') }
            Write-Host "• Process Status : " -NoNewline
            Write-Host "RUNNING" -ForegroundColor Green
            Write-Host "  - Master PID   : $masterPid"
            Write-Host "  - Memory Usage : $memoryMb MB"
            Write-Host "  - Start Time   : $startTimeStr"
        }
    } catch {}
}

function Get-ListeningPid([int]$targetPort) {
    try {
        $lines = (netstat -ano) -split "`r?`n"
        foreach ($line in $lines) {
            if ($line -match ":$targetPort\s+.*LISTENING\s+(\d+)") {
                return [int]$matches[1]
            }
        }
    } catch {}
    return $null
}

if (-not $isRunning) {
    # Check if port is bound anyway
    $listeningPid = Get-ListeningPid -targetPort $port
    if ($listeningPid) {
        Write-Host "• Process Status : " -NoNewline
        Write-Host "RUNNING (PID file missing, listening on port $port, PID: $listeningPid)" -ForegroundColor Yellow
        $isRunning = $true
    } else {
        Write-Host "• Process Status : " -NoNewline
        Write-Host "STOPPED (Not running)" -ForegroundColor DarkGray
    }
}

# 2. HTTP Health Probe
Write-Host "• Gateway Health : " -NoNewline
$healthUrl = "http://127.0.0.1:$port/health"
try {
    $health = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 2 -ErrorAction Stop
    if ($health.status -eq 'ok') {
        $inFlight = if ($null -ne $health.inFlightRequests) { $health.inFlightRequests } else { 0 }
        Write-Host "HEALTHY (HTTP 200)" -ForegroundColor Green
        Write-Host "  - Uptime       : $([math]::Round($health.uptime, 1)) seconds"
        Write-Host "  - In-Flight    : $inFlight requests"
        Write-Host "  - Worker PID   : $($health.pid)"
        Write-Host "  - Providers    : Google=$($health.providers.google), Codex=$($health.providers.codex)"
    } else {
        Write-Host "DEGRADED (Status: $($health.status))" -ForegroundColor Yellow
    }
} catch {
    if ($isRunning) {
        Write-Host "UNRESPONSIVE (Failed to connect to $healthUrl)" -ForegroundColor Red
    } else {
        Write-Host "OFFLINE" -ForegroundColor DarkGray
    }
}

# 3. Autostart Status (Startup Folder & Task Scheduler)
Write-Host "• Autostart State: " -NoNewline
$startupDir = [Environment]::GetFolderPath('Startup')
$startupVbs = Join-Path $startupDir "AgentModelGateway.vbs"
$hasStartup = Test-Path $startupVbs

$task = $null
try {
    $task = Get-ScheduledTask -TaskName "AgentModelGatewayDaemon" -ErrorAction SilentlyContinue
} catch {}

if ($hasStartup -and $task) {
    Write-Host "ENABLED (Startup Folder + Task Scheduler: $($task.State))" -ForegroundColor Green
} elseif ($hasStartup) {
    Write-Host "ENABLED (User Startup Folder: $startupVbs)" -ForegroundColor Green
} elseif ($task) {
    Write-Host "ENABLED (Windows Task Scheduler: $($task.State))" -ForegroundColor Green
} else {
    Write-Host "DISABLED (Run 'npm run service:install' to enable auto-start on boot/logon)" -ForegroundColor DarkGray
}

# 4. Logs
Write-Host "• Log Files      :"
if (Test-Path $logFile) {
    $logItem = Get-Item $logFile
    Write-Host "  - Service Log  : $logFile ($([math]::Round($logItem.Length / 1KB, 1)) KB, Last updated: $($logItem.LastWriteTime))"
} else {
    Write-Host "  - Service Log  : None"
}
if (Test-Path $errFile) {
    $errItem = Get-Item $errFile
    Write-Host "  - Error Log    : $errFile ($([math]::Round($errItem.Length / 1KB, 1)) KB, Last updated: $($errItem.LastWriteTime))"
}

Write-Host "======================================================================" -ForegroundColor Cyan
