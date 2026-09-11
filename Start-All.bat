@echo off
echo ========================================================
echo Starting Application Services (Without Docker)
echo ========================================================

echo.
echo [1/4] Starting AI Service (Node.js)...
start cmd /k "cd backend\ai_service && npm install && npm start"

echo.
echo [2/4] Starting STT Service (Python Flask)...
start cmd /k "cd backend\stt_service && python -m venv venv && call venv\Scripts\activate.bat && pip install -r requirements.txt && python app.py"

echo.
echo [3/4] Starting Vision Service (Python FastAPI)...
start cmd /k "cd backend\vision_service && python -m venv venv && call venv\Scripts\activate.bat && pip install -r requirements.txt && python main.py"

echo.
echo [4/4] Starting Frontend App (Expo Web)...
start cmd /k "cd frontend && npm install && npm run web"

echo.
echo All services have been launched in separate windows!
echo Please wait a moment for dependencies to install if this is your first run.
echo ========================================================
pause
