# Configuration
$Cloudflared = ".\cloudflared-windows-amd64.exe"
$Ports = @(3000, 5000, 7000)
$EnvFile = "frontend/.env"

# Clear or Create the .env file
Clear-Content -Path $EnvFile -ErrorAction SilentlyContinue
New-Item -ItemType File -Path $EnvFile -Force | Out-Null

Write-Host "--- Starting Cloudflare Tunnels ---" -ForegroundColor Cyan

foreach ($Port in $Ports) {
    Write-Host "Starting tunnel for port $Port..." -NoNewline
    
    # Define a temporary log file to capture the URL
    $LogFile = "temp_tunnel_$Port.log"
    
    # Start cloudflared in the background
    # We redirect stderr to a file because that's where the URL is printed
    Start-Process -FilePath $Cloudflared -ArgumentList "tunnel --url http://localhost:$Port" -NoNewWindow -RedirectStandardError $LogFile
    
    # Wait for the URL to appear in the log (up to 20 seconds)
    $Url = $null
    $Timeout = 20
    $Counter = 0
    
    while ($null -eq $Url -and $Counter -lt $Timeout) {
        Start-Sleep -Seconds 1
        if (Test-Path $LogFile) {
            $LogContent = Get-Content $LogFile
            # Look for the trycloudflare.com link
            $UrlMatch = $LogContent | Select-String -Pattern "https://[a-zA-Z0-9-]+\.trycloudflare\.com"
            if ($UrlMatch) {
                $Url = $UrlMatch.Matches.Value
            }
        }
        $Counter++
    }

    if ($Url) {
        $EnvLine = "EXPO_PUBLIC_URL_$Port=$Url"
        Add-Content -Path $EnvFile -Value $EnvLine
        Write-Host " Success! " -ForegroundColor Green
        Write-Host "URL: $Url" -ForegroundColor Gray
    } else {
        Write-Host " Failed (Timeout or Rate Limit)" -ForegroundColor Red
    }

    # Small delay to avoid the '429 Too Many Requests' error from Cloudflare
    Start-Sleep -Seconds 3
}

Write-Host "`n--- Done! Your .env file is updated ---" -ForegroundColor Cyan

# Also write STT_URL alias so ai.ts (port 3000) can reach app.py (port 5000) through the tunnel
$EnvContent = Get-Content -Path $EnvFile
$SttLine = $EnvContent | Select-String -Pattern "EXPO_PUBLIC_URL_5000="
if ($SttLine) {
    $SttUrl = ($SttLine -split "=", 2)[1]
    Add-Content -Path $EnvFile -Value "`nSTT_URL=$SttUrl"
    
    # Also write STT_URL to ai_service/.env for the backend to use
    $AiEnvFile = "backend/ai_service/.env"
    Add-Content -Path $AiEnvFile -Value "STT_URL=$SttUrl"
    
    Write-Host "STT_URL alias added: $SttUrl" -ForegroundColor Gray
}

Write-Host "`nPort Mapping:" -ForegroundColor White
Write-Host "  3000 = AI Navigation Server (ai.ts)" -ForegroundColor Gray
Write-Host "  5000 = STT Flask Server (app.py)" -ForegroundColor Gray
Write-Host "  7000 = YOLO Vision Server (main.py)" -ForegroundColor Gray
Write-Host "`nKeep this terminal open to keep the tunnels alive."