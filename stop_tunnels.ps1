Write-Host "Stopping all Cloudflare tunnels..." -ForegroundColor Yellow
Stop-Process -Name "cloudflared-windows-amd64" -ErrorAction SilentlyContinue
Write-Host "Tunnels stopped." -ForegroundColor Green

# Optional: Clean up the temporary log files created by the start script
Remove-Item temp_tunnel_*.log -ErrorAction SilentlyContinue