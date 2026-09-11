    Write-Host "🚀 Starting All Backend Services..." -ForegroundColor Cyan

    #  Start STT Server (Port 5000)
    Write-Host "  🎙️  Starting STT Server (Flask)..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd backend/stt_service; python app.py" -WindowStyle Normal

    #  Start AI Navigation Server (Port 3000)
    Write-Host "  🧠  Starting AI Navigation Server (Express)..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd backend/ai_service; npx tsx ai.ts" -WindowStyle Normal

    #  Start YOLO Vision Server (Port 7000)
    Write-Host "  👁️  Starting YOLO Vision Server (Uvicorn)..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd backend/vision_service; python main.py" -WindowStyle Normal

    Write-Host "`n✅ All services starting in separate windows." -ForegroundColor Green
    Write-Host "Please wait for them to initialize before using the tunnels." -ForegroundColor White
