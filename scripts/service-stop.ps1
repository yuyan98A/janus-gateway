# Windows Background Service Stopper for Agent Model Gateway
# Gracefully terminates the cluster master and worker process tree.

$ErrorActionPreference = 'SilentlyContinue'
$rootDir = (Resolve-Path "$PSScriptRoot\..").Path
$pidFile = Join-Path $rootDir "data\gateway.pid"

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

if (-not (Test-Path $pidFile)) {
    # Check if port 18763 is in use
    $listeningPid = Get-ListeningPid -targetPort 18763
    if ($listeningPid) {
        Write-Host "[Service] Found running process on port 18763 (PID: $listeningPid) without PID file. Stopping..." -ForegroundColor Yellow
        taskkill /PID $listeningPid /T /F | Out-Null
        Write-Host "[Service] Process terminated." -ForegroundColor Green
        exit 0
    }
    Write-Host "[Service] Agent Model Gateway is not running." -ForegroundColor Yellow
    exit 0
}

try {
    $pidContent = Get-Content $pidFile -Raw | ConvertFrom-Json
    $masterPid = [int]$pidContent.pid
} catch {
    $masterPid = 0
}

if ($masterPid -le 0 -or -not (Get-Process -Id $masterPid -ErrorAction SilentlyContinue)) {
    Write-Host "[Service] Gateway process (PID: $masterPid) is not active. Cleaning up stale PID file..." -ForegroundColor Yellow
    Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
    exit 0
}

Write-Host "[Service] Stopping Agent Model Gateway (Master PID: $masterPid)..." -ForegroundColor Cyan

# Terminate process tree (Master and all Workers)
taskkill /PID $masterPid /T /F | Out-Null

Start-Sleep -Milliseconds 800

if (-not (Get-Process -Id $masterPid -ErrorAction SilentlyContinue)) {
    Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
    Write-Host "[Service] Agent Model Gateway stopped successfully." -ForegroundColor Green
} else {
    Write-Warning "[Service] Process $masterPid did not terminate immediately. Forcing shutdown..."
    Stop-Process -Id $masterPid -Force -ErrorAction SilentlyContinue
    Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
    Write-Host "[Service] Gateway stopped." -ForegroundColor Green
}
