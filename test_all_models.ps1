$models = @(
    "claude-opus-4-6-thinking",
    "claude-sonnet-4-6",
    "gemini-3.1-pro-low",
    "gemini-3.1-pro-high",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-3.8-flash-high",
    "gemini-3.8-flash-medium",
    "gemini-3.8-flash-low",
    "gemini-3.8-flash-tiered",
    "gemini-3.7-flash-high",
    "gemini-3.7-flash-medium",
    "gemini-3.7-flash-low",
    "gemini-3.7-flash-tiered",
    "gemini-3.6-flash-high",
    "gemini-3.6-flash-medium",
    "gemini-3.6-flash-low",
    "gemini-3.6-flash-tiered",
    "gemini-3.5-flash-low",
    "gemini-3.5-flash-extra-low",
    "gemini-3.5-flash-lite"
)

$results = @()

foreach ($m in $models) {
    Write-Host "[Testing] $m ... " -NoNewline
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    
    $body = @{
        model = $m
        max_tokens = 300
        messages = @(
            @{
                role = "user"
                content = "Ping! Please reply with 'PONG' and your model name."
            }
        )
    } | ConvertTo-Json -Depth 5

    try {
        $resp = Invoke-RestMethod -Uri "http://localhost:8080/v1/messages" -Method Post -Headers @{
            "Content-Type" = "application/json"
            "x-api-key" = "test"
        } -Body $body -TimeoutSec 40
        $sw.Stop()

        $textPart = ""
        foreach ($c in $resp.content) {
            if ($c.type -eq "text" -and $c.text) {
                $textPart += $c.text + " "
            }
        }
        if (-not $textPart) {
            foreach ($c in $resp.content) {
                if ($c.type -eq "thinking" -and $c.thinking) {
                    $textPart += "[Thinking: " + $c.thinking.Substring(0, [Math]::Min(30, $c.thinking.Length)) + "] "
                }
            }
        }
        $cleanText = ($textPart -replace '\s+', ' ').Trim()
        if ($cleanText.Length -gt 60) {
            $cleanText = $cleanText.Substring(0, 60) + "..."
        }

        Write-Host "SUCCESS ($($sw.ElapsedMilliseconds)ms)" -ForegroundColor Green
        $results += [PSCustomObject]@{
            Model = $m
            Status = "OK"
            LatencyMs = $sw.ElapsedMilliseconds
            Output = $cleanText
        }
    } catch {
        $sw.Stop()
        $msg = $_.Exception.Message
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
            $msg = $_.ErrorDetails.Message
        }
        Write-Host "FAILED ($($sw.ElapsedMilliseconds)ms): $msg" -ForegroundColor Red
        $cleanErr = ($msg -replace '\s+', ' ').Trim()
        if ($cleanErr.Length -gt 60) {
            $cleanErr = $cleanErr.Substring(0, 60) + "..."
        }
        $results += [PSCustomObject]@{
            Model = $m
            Status = "ERROR"
            LatencyMs = $sw.ElapsedMilliseconds
            Output = $cleanErr
        }
    }
    Start-Sleep -Milliseconds 600
}

$results | Format-Table -AutoSize
$results | ConvertTo-Json | Set-Content -Path "test_results.json" -Encoding UTF8
