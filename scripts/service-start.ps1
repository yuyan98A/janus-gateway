# Windows Background Service Starter for Agent Model Gateway
# Runs the cluster orchestrator silently in the background without a console window.

$ErrorActionPreference = 'Stop'
$rootDir = (Resolve-Path "$PSScriptRoot\..").Path
$logsDir = Join-Path $rootDir "logs"
$dataDir = Join-Path $rootDir "data"
$pidFile = Join-Path $dataDir "gateway.pid"

if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
}
if (-not (Test-Path $dataDir)) {
    New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
}

# 1. Check if gateway is already running
if (Test-Path $pidFile) {
    try {
        $pidContent = Get-Content $pidFile -Raw | ConvertFrom-Json
        $existingPid = [int]$pidContent.pid
        if ($existingPid -gt 0 -and (Get-Process -Id $existingPid -ErrorAction SilentlyContinue)) {
            $servicePort = if ($pidContent.port) { $pidContent.port } else { 18763 }
            $healthUrl = "http://127.0.0.1:$servicePort/health"
            try {
                $health = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 2 -ErrorAction Stop
                if ($health.status -eq 'ok') {
                    Write-Host "[Service] Agent Model Gateway is already running." -ForegroundColor Green
                    Write-Host "  - Master PID : $existingPid"
                    Write-Host "  - Status     : $healthUrl (OK)"
                    Write-Host "  - Uptime     : $([math]::Round($health.uptime, 1))s"
                    Write-Host "  - Hint       : Use 'npm run reload' to hot-reload or 'npm run service:stop' to terminate."
                    exit 0
                }
            } catch {
                # Process exists but not responding yet, proceed or warn
            }
        }
    } catch {
        # Corrupted PID file, ignore and continue
    }
}

# 2. Locate node.exe
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    Write-Error "[Service] Node.js is not found in PATH. Please ensure Node.js is installed."
    exit 1
}
$nodeExe = $nodeCommand.Source
$clusterScript = Join-Path $rootDir "src\cluster.ts"
$outLog = Join-Path $logsDir "service.log"
$errLog = Join-Path $logsDir "service-error.log"

Write-Host "[Service] Starting Agent Model Gateway cluster in background..." -ForegroundColor Cyan

# 3. Launch cluster in hidden window with OS-level stdout/stderr redirection
$cmdArgs = "/c `"`"$nodeExe`" --experimental-strip-types `"$clusterScript`" >> `"$outLog`" 2>&1`""
$process = Start-Process -FilePath "cmd.exe" `
    -ArgumentList $cmdArgs `
    -WorkingDirectory $rootDir `
    -WindowStyle Hidden `
    -PassThru

if (-not $process -or $process.HasExited) {
    Write-Error "[Service] Failed to spawn Node.js background process."
    if (Test-Path $outLog) {
        Get-Content $outLog -Tail 10 | Write-Host -ForegroundColor Red
    }
    exit 1
}

# 4. Wait for gateway to report healthy on HTTP
$maxWaitSeconds = 20
$startTime = [DateTime]::UtcNow
$isHealthy = $false
$healthUrl = "http://127.0.0.1:18763/health"

while (([DateTime]::UtcNow - $startTime).TotalSeconds -lt $maxWaitSeconds) {
    Start-Sleep -Milliseconds 600
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 2 -ErrorAction Stop
        if ($health.status -eq 'ok') {
            $isHealthy = $true
            break
        }
    } catch {
        # Gateway is still initializing
    }

    if ($process.HasExited) {
        Write-Error "[Service] Gateway process exited prematurely with code $($process.ExitCode)."
        if (Test-Path $errLog) {
            Write-Host "`n[Service Error Output]:" -ForegroundColor Red
            Get-Content $errLog -Tail 15 | Write-Host -ForegroundColor Red
        }
        exit 1
    }
}

if ($isHealthy) {
    $masterPid = $process.Id
    if (Test-Path $pidFile) {
        try {
            $pidInfo = Get-Content $pidFile -Raw | ConvertFrom-Json
            if ($pidInfo.pid) { $masterPid = $pidInfo.pid }
        } catch {}
    }

    Write-Host "`n======================================================================" -ForegroundColor Green
    Write-Host "🚀 Agent Model Gateway Background Service Started Successfully" -ForegroundColor Green
    Write-Host "======================================================================" -ForegroundColor Green
    Write-Host "  - Master PID     : $masterPid"
    Write-Host "  - Target Address : http://127.0.0.1:18763"
    Write-Host "  - Health Status  : $healthUrl (OK)"
    Write-Host "  - Service Log    : logs\service.log"
    Write-Host "  - Error Log      : logs\service-error.log"
    Write-Host "  - Hot Reload     : npm run reload"
    Write-Host "  - Check Status   : npm run service:status"
    Write-Host "  - Stop Service   : npm run service:stop"
    Write-Host "======================================================================`n"
} else {
    Write-Error "[Service] Timed out waiting for gateway to become healthy on $healthUrl."
    if (Test-Path $errLog) {
        Get-Content $errLog -Tail 15 | Write-Host -ForegroundColor Red
    }
    exit 1
}
