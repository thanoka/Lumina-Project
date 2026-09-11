#!/bin/bash
echo "========================================================"
echo "Starting Application Services (Without Docker)"
echo "========================================================"

# AI Service
echo "[1/4] Starting AI Service (Node.js)..."
cd backend/ai_service && npm install && npm start &
PID_AI=$!
cd ../..

# STT Service
echo "[2/4] Starting STT Service (Python Flask)..."
cd backend/stt_service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py &
PID_STT=$!
deactivate
cd ../..

# Vision Service
echo "[3/4] Starting Vision Service (Python FastAPI)..."
cd backend/vision_service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python main.py &
PID_VISION=$!
deactivate
cd ../..

# Frontend
echo "[4/4] Starting Frontend App (Expo Web)..."
cd frontend && npm install && npm run web &
PID_FRONTEND=$!
cd ..

echo "All services have been launched in the background!"
echo "To stop them, press Ctrl+C."

# Wait for all background processes
trap "kill $PID_AI $PID_STT $PID_VISION $PID_FRONTEND" SIGINT
wait $PID_AI $PID_STT $PID_VISION $PID_FRONTEND
