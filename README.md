# M-Project: AI Navigation Assistant 🧭

A sophisticated, multi-service navigation assistant using AI, Vision processing, and Speech-To-Text (STT) to guide users safely through complex environments like hospitals or public buildings.

## 🏛️ System Architecture

This project has been modularized into 4 independent microservices:
1. **Frontend App (`/frontend`)**: An Expo React Native app that captures camera frames, records audio, handles local routing logic, and presents an interactive UI.
2. **AI Service (`/backend/ai_service`)**: A Node.js backend running on Port `3000`. It processes context and natural language using the OpenRouter AI API.
3. **STT Service (`/backend/stt_service`)**: A Python Flask backend running on Port `5000`. It transcribes speech to text securely using Google's SpeechRecognition API.
4. **Vision Service (`/backend/vision_service`)**: A Python FastAPI backend running on Port `7000`. It runs YOLO models to detect text, signs, and physical obstacles in the camera's view.

---

## 🚀 How to Run the Project (Portability Options)

You can run this project on **any PC** (Windows, Mac, or Linux). We provide two ways to start the entire system: using Docker (Recommended) or our One-Click startup scripts.

### Pre-requisites (Configuration)
Before starting, ensure your API keys are configured:
1. Copy the `google_key.json` into `/backend/vision_service/` (for Google Cloud OCR).
2. Open `/backend/ai_service/.env` and insert your `OPENROUTER_API_KEY`.

---

### Option 1: Using Docker Compose (Highly Recommended)
Docker completely containerizes the app. You don't need Python or Node.js installed on your computer.
1. Download and install [Docker Desktop](https://www.docker.com/products/docker-desktop/).
2. Open a terminal in the root folder of this project.
3. Run the following command:
   ```bash
   docker-compose up --build
   ```
4. Once everything starts, open your web browser and go to `http://localhost:8081` to view the frontend!

---

### Option 2: One-Click Startup Scripts
If you prefer not to use Docker, ensure you have **Node.js** and **Python 3.10+** installed on your PC.

**For Windows:**
1. Double-click the `Start-All.bat` file in the root folder.
2. This will open 4 separate terminal windows, automatically install all `npm` and `pip` dependencies, create virtual environments, and start all servers.
3. In the frontend terminal window, press `w` to open the web version in your browser (or wait for it to pop up).

**For Mac/Linux:**
1. Open a terminal and run `chmod +x Start-All.sh`.
2. Run `./Start-All.sh`.
3. All services will install dependencies and start in the background. Press `Ctrl+C` to cleanly exit them.

---

## 🛠️ Modifying the Floorplan
The navigation nodes, waypoints, and hospital layout are defined in `frontend/data/data-mock.json`. You can modify coordinates and connections here to map out a completely new environment!

---

## 🛑 Troubleshooting
- **Missing `ffmpeg` error**: If you are not using Docker and the STT service crashes when processing voice data on Windows, you must install [ffmpeg](https://ffmpeg.org/download.html) and add it to your system PATH. (The Docker approach bypasses this issue entirely).
- **Blank Screen on Web**: Refresh the page at `http://localhost:8081`. Sometimes the Expo Web bundler takes a second to compile standard React Native components.
