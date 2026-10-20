# Lumina-Project — "Lumi" AI Indoor Navigation Assistant for Blind Users

> A camera-first, voice-only indoor navigation assistant that guides visually impaired users through hospitals and other complex public buildings — using YOLO object detection, Google Vision OCR, a graph-based route planner, and an LLM that turns structured navigation events into warm, natural Thai speech.

<p align="left">
  <img alt="Expo" src="https://img.shields.io/badge/Expo-54-000020?logo=expo&logoColor=white">
  <img alt="React Native" src="https://img.shields.io/badge/React%20Native-0.81-61DAFB?logo=react&logoColor=black">
  <img alt="Node" src="https://img.shields.io/badge/Node.js-20-339933?logo=nodedotjs&logoColor=white">
  <img alt="Python" src="https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white">
  <img alt="FastAPI" src="https://img.shields.io/badge/FastAPI-Vision-009688?logo=fastapi&logoColor=white">
  <img alt="Docker" src="https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white">
</p>

---

## Table of Contents

- [What it does](#what-it-does)
- [System architecture](#system-architecture)
- [Repository structure](#repository-structure)
- [Tech stack](#tech-stack)
- [How the pipeline works](#how-the-pipeline-works)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Running on a physical phone (Cloudflare tunnels)](#running-on-a-physical-phone-cloudflare-tunnels)
- [API reference](#api-reference)
- [Map data format](#map-data-format)
- [Accessibility interaction model](#accessibility-interaction-model)
- [Simulator — testing without a building](#simulator--testing-without-a-building)
- [Security notes](#security-notes)
- [Troubleshooting](#troubleshooting)
- [Known limitations & roadmap](#known-limitations--roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## What it does

Indoor GPS does not work. For a blind user, "the registration desk is 15 steps to your left, just past the big sign" is the information that actually matters — and that information only exists in what the camera sees.

M-Project streams camera frames from a phone to a vision service, figures out **where the user is standing** by matching detected signs and landmarks against a hand-authored floor-plan graph, plans a **turn-aware walking route** with BFS, watches for **obstacles and drift** on every frame, and then hands a stream of structured JSON events to an LLM persona named **Lumi (ลูมี่)** that speaks short, warm, urgency-aware Thai through the phone's text-to-speech engine.

Core capabilities:

- **Visual self-localization** — weighted scoring of YOLO labels + OCR sign text + expected screen position against map nodes.
- **Turn-aware routing** — BFS shortest path over the building graph, with instructions phrased as landmark triggers ("walk forward, when the REGISTRATION sign fills your view, turn left").
- **Proximity safety alerts** — objects growing past size thresholds fire `warning` / `danger` events that interrupt all other speech.
- **Drift correction** — if a landmark that should be centered appears to the left, the user is nudged back on line.
- **Automatic rerouting** — walking off-route triggers a fresh BFS from the new position.
- **Voice destination input** — hold the screen, speak a destination in Thai, Google STT transcribes it, and an LLM intent filter maps free speech onto a real map node ID.
- **Emotion-modulated speech** — every event carries an `intensity` (0.0–1.0) that maps to TTS rate and pitch, so danger sounds urgent and arrival sounds happy.
- **Haptics** — heavy buzz on danger/arrival, medium on turns and warnings.

---

## System architecture

Four independent services. The frontend owns all navigation logic locally; backends are stateless.

```
                         ┌──────────────────────────────────────┐
                         │        Frontend (Expo RN)            │
                         │  camera · mic · TTS · haptics · UI   │
                         │                                      │
                         │   lib/navigation/ NavigationEngine   │
                         │   (localization, BFS route, safety)  │
                         └───┬──────────────┬──────────────┬────┘
             JPEG frame      │              │ audio blob   │ NavOutput JSON
                             ▼              ▼              ▼
            ┌────────────────────┐ ┌──────────────┐ ┌──────────────────────┐
            │  Vision Service    │ │ STT Service  │ │     AI Service       │
            │  FastAPI  :7000    │ │ Flask :5000  │ │  Express/TS  :3000   │
            │  YOLO26 + text det │ │ Google STT   │ │  OpenRouter LLM      │
            │  + Google Cloud OCR│ │  (th-TH)     │ │  Llama 3.3 70B       │
            └────────────────────┘ └──────────────┘ └──────────────────────┘
                     │                                        │
             detections[] + sign_text              { text, intensity,
                     │                                suggestion, tag }
                     └────────────► NavigationEngine ─────────┘
                                           │
                                           ▼
                                  Thai voice guidance
```

| Service | Port | Runtime | Responsibility |
|---|---|---|---|
| `frontend` | 8081 | Expo / React Native (web + native) | Camera capture loop, audio recording, navigation engine, TTS, haptics, accessible UI |
| `backend/ai_service` | 3000 | Node.js 20 + TypeScript (Express 5, `tsx`) | Turns `NavOutput` events into natural Thai sentences; intent filtering for spoken destinations |
| `backend/stt_service` | 5000 | Python 3.11 (Flask) | Audio → 16 kHz mono WAV via ffmpeg → Google SpeechRecognition (`th-TH`) |
| `backend/vision_service` | 7000 | Python 3.11 (FastAPI + Uvicorn) | YOLO safety detection, YOLO text-region detection, Google Cloud Vision OCR on sign crops, 9-cell grid localization |

---

## Repository structure

```
m-project/
├── docker-compose.yml              # One-command orchestration of all 4 services
├── Start-All.sh / Start-All.bat    # Docker-free startup (installs deps, launches all services)
├── start_services.ps1              # Windows: launch the 3 backends in separate terminals
├── start_tunnels.ps1               # Windows: open Cloudflare tunnels and write frontend/.env
├── stop_tunnels.ps1                # Windows: kill all cloudflared processes
│
├── backend/
│   ├── ai_service/
│   │   ├── ai.ts                   # Express server: POST /navigate, POST /filter
│   │   ├── config.ts               # Thai fallback templates, event priority, intensity hints
│   │   └── Dockerfile
│   ├── stt_service/
│   │   ├── app.py                  # Flask app: GET /health, POST /transcribe
│   │   ├── stt_service.py          # ffmpeg conversion + Google SpeechRecognition
│   │   └── Dockerfile
│   └── vision_service/
│       ├── main.py                 # FastAPI: POST /process-frame
│       ├── yolo26m.pt              # Safety/object model (43 MB)
│       ├── text_detector.pt        # Sign/text-region model (5 MB)
│       ├── grid_reference.jpg      # Visual reference for the 9-cell grid
│       └── Dockerfile
│
└── frontend/
    ├── app/
    │   ├── index.tsx               # Main screen: camera stream loop + voice UX
    │   ├── simulator.tsx           # Offline simulator for the whole navigation engine
    │   └── sound.tsx               # Standalone audio/recording test screen
    ├── lib/
    │   ├── navigation/
    │   │   ├── navigationEngine.ts # 8-step per-frame orchestrator → NavOutput
    │   │   ├── locationMatcher.ts  # Weighted "where am I" scoring
    │   │   ├── routePlanner.ts     # BFS path + Thai instruction generation
    │   │   ├── safetyAnnouncer.ts  # Proximity warning/danger with cooldowns
    │   │   ├── simulator.ts        # Mock frame generator
    │   │   ├── types.ts            # Shared TypeScript contracts
    │   │   └── README.md           # Deep-dive spec for the navigation subsystem
    │   └── voice.ts                # Priority speech queue + emotion → rate/pitch mapping
    ├── data/
    │   ├── data-mock.json          # Bangkok Hospital ground-floor demo map (5 nodes)
    │   └── data-simple.json        # Minimal 2-node map for smoke tests
    └── app.json                    # Expo config (permissions, plugins, adaptive icons)
```

The navigation subsystem has its own, much more detailed specification in [`frontend/lib/navigation/README.md`](frontend/lib/navigation/README.md) — read that before changing scoring weights, thresholds, or the event contract.

---

## Tech stack

**Frontend** — Expo SDK 54, React Native 0.81, React 19, `expo-router` (typed routes), `expo-camera`, `expo-audio` / `expo-av`, `expo-speech`, `expo-haptics`, `react-native-reanimated`, TypeScript 5.9, `axios`.

**AI service** — Express 5, `multer`, `dotenv`, `cors`, the `openai` SDK pointed at **OpenRouter** (`meta-llama/llama-3.3-70b-instruct`), run directly from TypeScript with `tsx`.

**STT service** — Flask, `flask-cors`, `SpeechRecognition` (Google Web Speech, `th-TH`), `ffmpeg` via subprocess for format normalization.

**Vision service** — FastAPI, Uvicorn, Ultralytics YOLO (two models: general safety objects + text regions), Google Cloud Vision OCR, Pillow.

**Infra** — Docker Compose, Cloudflare Tunnel (`cloudflared`) for exposing local backends to a physical phone.

---

## How the pipeline works

### Per-frame loop (frontend)

1. `expo-camera` takes a low-quality JPEG (`quality: 0.1`, `skipProcessing: true`) and posts it as multipart form data to `POST /process-frame`.
2. The vision service runs both YOLO models, computes each box's `size_pct` (box area ÷ frame area) and a 9-cell `grid_location`, then runs Google Cloud Vision OCR **only** on high-confidence text regions, upper-casing the result.
3. The frontend feeds that `FrameResponse` into `NavigationEngine.processFrame()`, which runs eight steps and returns a `NavOutput`.
4. Any events in `NavOutput` are posted to `POST /navigate`, which asks the Lumi LLM persona for `{ text, intensity }`, adds a rule-based `suggestion`, and returns it.
5. `lib/voice.ts` speaks the result — `intensity` is linearly mapped to TTS rate (1.0 → 1.6) and pitch (0.9 → 1.25). `critical` priority clears the queue and interrupts; everything else queues in order.
6. The loop re-arms after ~50 ms; live FPS and round-trip latency are shown on screen.

### The eight engine steps

| Step | What it does |
|---|---|
| 1. Safety check | Any detection ≥ 5 % of frame → `warning`; ≥ 15 % → `danger`. 5-second cooldown per object+grid pair. |
| 2. Location matching | Weighted scoring over all map nodes; requires ≥ 40 % confidence **and** two consecutive matching frames before committing. |
| 3. Route trigger | If state is `locating` and a position is found, plan the route automatically. |
| 4. Route progress | Detects step completion, waypoint pass-through, arrival, and off-route conditions (off-route → BFS reroute). |
| 5. Turn-ref monitoring | Watches the current step's trigger landmark: `size_pct ≥ warn_at` → `approaching_turn`; `≥ turn_at` → `turn_now`. Each fires once. |
| 6. Sign reading | Unrecognized sign text → `sign_read` (5-second cooldown). |
| 7. Alignment correction | Landmark seen left of its expected column → suggest `turn_right`, and vice versa. 3-second cooldown per object. |
| 8. Guidance | Searching for more than 4 s with no match → `guidance_needed` ("please turn slowly"). |

### Localization scoring

| Signal | Score contribution |
|---|---|
| Sign OCR text exact match | +0.50 × (1 ÷ priority) |
| Sign OCR text partial match | +0.30 × (1 ÷ priority) |
| Object label in the expected column | +0.20 × (1 ÷ priority) |
| Object label, wrong column | +0.10 × (1 ÷ priority) |
| Ambient (`parameter_item`) object present | +0.05 |

Scores are normalized so the best candidate is 1.0, then anything under 15 % confidence is discarded. Label synonyms are handled (`tv` ≈ `monitor` ≈ `screen`, `dining table` ≈ `desk`).

### Navigation states

`idle` → `locating` → `navigating` → `arrived`, plus `lost` and `rerouting`.

### Event catalogue (LLM speech priority order)

`danger` → `warning` → `turn_now` → `approaching_turn` → `alignment_correction` → `reroute` → `location_update` → `navigation_step` → `route_started` → `destination_set` → `arrived`

Additional informational tags: `waypoint_reached`, `sign_read`, `guidance_needed`, `already_there`, `no_route`, `navigation_cancelled`. Every tag has a Thai fallback template in `backend/ai_service/config.ts`, so the app still speaks correctly if the LLM call fails or returns malformed JSON.

---

## Quick start

### Prerequisites

- **Docker route:** Docker Desktop only.
- **Manual route:** Node.js 20+, Python 3.10+, and `ffmpeg` on your `PATH`.
- An **OpenRouter API key** — <https://openrouter.ai/keys>
- A **Google Cloud service-account JSON** with the Cloud Vision API enabled — <https://console.cloud.google.com/apis/library/vision.googleapis.com>

### 1. Configure credentials

```bash
cp backend/ai_service/.env.example backend/ai_service/.env   # then fill in your key
```

```env
# backend/ai_service/.env
OPENROUTER_API_KEY=sk-or-v1-...
PORT=3000
# Optional: only needed if the AI service must reach the STT service through a tunnel
STT_URL=http://localhost:5000
```

Place your Google service-account file at `backend/vision_service/google_key.json` (or point `GOOGLE_VISION` at another path in `backend/vision_service/.env.local`).

### 2a. Run with Docker Compose (recommended)

```bash
docker compose up --build
```

Then open <http://localhost:8081>. Compose injects `EXPO_PUBLIC_URL_3000/5000/7000` pointing at `localhost`, so the web build works with no extra configuration.

### 2b. Run without Docker

**macOS / Linux**

```bash
chmod +x Start-All.sh
./Start-All.sh          # installs npm + pip deps, creates venvs, starts all 4 services
```

**Windows**

```bat
Start-All.bat
```

…or, if you only want the backends in separate terminals:

```powershell
.\start_services.ps1
```

Start each piece by hand if you prefer:

```bash
# AI service
cd backend/ai_service && npm install && npm start          # tsx ai.ts  → :3000

# STT service
cd backend/stt_service && pip install -r requirements.txt && python app.py   # → :5000

# Vision service
cd backend/vision_service && pip install -r requirements.txt && python main.py  # → :7000

# Frontend
cd frontend && npm install && npm run web                  # → :8081
```

### 3. Grant permissions

On first launch the app asks for **camera** and **microphone** access. On the native app this is intentionally gated behind a 5-second press-and-hold with a spoken countdown, so a blind user can trigger it without hunting for a button.

---

## Environment variables

### `backend/ai_service/.env`

| Variable | Required | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | yes | OpenRouter key used for the Lumi persona and intent filter |
| `PORT` | no | Defaults to `3000` |
| `STT_URL` | no | Base URL of the STT service, used when both run behind tunnels |

### `backend/vision_service/.env.local`

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_VISION` | no | Path to the service-account JSON. Defaults to `google_key.json` |

### `frontend/.env`

| Variable | Required | Description |
|---|---|---|
| `EXPO_PUBLIC_URL_3000` | yes | Base URL of the AI service |
| `EXPO_PUBLIC_URL_5000` | yes | Base URL of the STT service |
| `EXPO_PUBLIC_URL_7000` | yes | Base URL of the vision service |

Expo only exposes variables prefixed with `EXPO_PUBLIC_` to client code — keep secrets out of `frontend/.env`.

---

## Running on a physical phone (Cloudflare tunnels)

A phone on Wi-Fi cannot reach `localhost` on your PC, so the three backends are published through Cloudflare quick tunnels.

```powershell
.\start_services.ps1     # 1. start the backends first
.\start_tunnels.ps1      # 2. open tunnels for 3000 / 5000 / 7000
```

`start_tunnels.ps1` opens one `cloudflared` tunnel per port, waits up to 20 s for each `*.trycloudflare.com` URL, rewrites `frontend/.env` with the three `EXPO_PUBLIC_URL_*` values, and appends `STT_URL` to `backend/ai_service/.env`. It sleeps 3 s between tunnels to dodge Cloudflare's `429` rate limit. Keep that terminal open — closing it kills the tunnels.

```powershell
cd frontend; npm start   # 3. Expo dev server, then scan the QR code
.\stop_tunnels.ps1       # 4. tear everything down when done
```

---

## API reference

### Vision service — `POST http://localhost:7000/process-frame`

Multipart form data, field name `file`, a JPEG frame.

```json
{
  "status": "success",
  "detections": [
    { "label": "person",  "grid_location": "center_left", "size_pct": 0.1832, "type": "safety" },
    { "label": "SIGN", "grid_location": "center", "size_pct": 0.0412, "type": "text",
      "text_content": "REGISTRATION & ADMISSION" }
  ],
  "can_read_sign": true,
  "sign_text": "REGISTRATION & ADMISSION"
}
```

Notes: YOLO safety detections use `conf=0.4`; text regions use `conf=0.5` and are only OCR'd above `0.75`. `size_pct` is box area ÷ frame area, rounded to 4 decimals. `sign_text` is only populated from a sign in the `center` cell.

### STT service

`GET /health` → `{ "ok": true, "services": ["stt"] }`

`POST /transcribe` — multipart form data, field name `file`, any audio format.

```json
{ "status": "success", "text": "พาไปจุดลงทะเบียน" }
```

Errors return HTTP `400` (no file) or `422` with a Thai, speakable message — e.g. `"ฟังไม่ออก ลองพูดใหม่อีกครั้ง"`. Audio is normalized to 16 kHz mono 16-bit WAV with ffmpeg, transcribed, and the temporary files are deleted in a `finally` block.

### AI service — `POST http://localhost:3000/navigate`

Body: a full `NavOutput` object (must contain an `events` array).

```json
{
  "success": true,
  "text": "เลี้ยวซ้ายเลยค่ะ! ป้าย Registration อยู่ตรงหน้าแล้ว",
  "intensity": 0.8,
  "suggestion": "",
  "tag": "turn_now"
}
```

The sentence is also returned base64-encoded in the `X-Nav-Text` response header (useful for clients that cannot parse the body before playback). If the LLM fails, the Thai template from `config.ts` is substituted and the request still succeeds.

### AI service — `POST http://localhost:3000/filter`

Maps free-form speech onto a concrete destination ID.

```json
{
  "text": "อยากไปห้องน้ำ",
  "destinations": [
    { "id": "GF_Restrooms", "name": "ห้องน้ำสาธารณะ" },
    { "id": "GF_Registration", "name": "จุดลงทะเบียน" }
  ],
  "contextInfo": "Current location: ทางเข้าหลัก"
}
```

Returns the parsed LLM decision (destination ID plus intent). `400` if `text` is missing.

### `NavOutput` shape (frontend → AI service)

```json
{
  "state": "navigating",
  "current_location": { "id": "GF_Main_Entrance", "name": "ทางเข้าหลัก", "confidence": 85 },
  "destination":      { "id": "GF_Registration",  "name": "จุดลงทะเบียน" },
  "route": {
    "step_index": 0,
    "total_steps": 1,
    "current_step": {
      "direction": "left",
      "distance": "15 ก้าว",
      "path_type": "open_foyer",
      "from": "GF_Main_Entrance",
      "to": "GF_Registration",
      "instruction": "เริ่มต้น เดินตรงไปข้างหน้า ผ่านห้องโถง เมื่อเห็น \"REGISTRATION & ADMISSION\" ให้เลี้ยวซ้าย ประมาณ 15 ก้าว",
      "turn_ref": { "object_name": "sign", "text_content": "REGISTRATION & ADMISSION", "warn_at": 0.20, "turn_at": 0.30 }
    }
  },
  "safety": [],
  "events": [{ "tag": "turn_now", "data": { "direction": "left", "landmark": "REGISTRATION & ADMISSION", "size_pct": 0.31 } }]
}
```

---

## Map data format

Buildings live in `frontend/data/data-mock.json` as an array of hospitals, each with a `FloorPlan` array of nodes. The bundled demo is **โรงพยาบาลกรุงเทพ (Bangkok Hospital)** with five ground-floor nodes:

| ID | Name | Type | Environment (`mtype`) |
|---|---|---|---|
| `GF_Main_Entrance` | ทางเข้าหลัก | `place` | `high_ceiling_lobby` |
| `GF_Central_Hall` | ห้องโถงที่ 1 | `hall` | `transition_zone` |
| `GF_Registration` | จุดลงทะเบียน | `place` | `administrative_desk` |
| `GF_Screening` | จุดคัดกรอง | `place` | `checkup_point` |
| `GF_Restrooms` | ห้องน้ำสาธารณะ | `end` | `amenity_node` |

```json
{
  "id": "GF_Main_Entrance",
  "name": "ทางเข้าหลัก",
  "type": "place",
  "neighbors": [
    {
      "target_id": "GF_Registration",
      "direction": "left",
      "distance_approx": "15 ก้าว",
      "path_type": "open_foyer",
      "turn_ref": {
        "object_name": "sign",
        "text_content": "REGISTRATION & ADMISSION",
        "warn_at": 0.20,
        "turn_at": 0.30
      }
    }
  ],
  "reference-point": [
    { "object_name": "sign", "text_content": "MAIN ENTRANCE", "priority": 1, "location_in_frame": "center" },
    { "object_name": "tv", "priority": 2, "location_in_frame": "center" }
  ],
  "parameter_item": [
    { "object_name": "potted plant", "count": "4 unit", "description": "Large fixed floor planters" }
  ],
  "instruction_on_arrival": "คุณมาถึงห้องโถงทางเข้าหลักแล้ว",
  "mtype": "high_ceiling_lobby"
}
```

| Field | Meaning |
|---|---|
| `type` | `place` (a valid destination) · `hall` (pass-through waypoint) · `end` (terminal node) |
| `neighbors[].direction` | `forward` · `backward` · `left` · `right` |
| `neighbors[].path_type` | `open_foyer` · `open_hall` · `corridor` · `stairway` · `elevator` |
| `neighbors[].turn_ref` | Only on turning edges — the landmark and size thresholds that trigger the turn |
| `reference-point[].priority` | `1` = strong identity signal (weight ×1.0), `2` = ×0.5, `3` = ×0.33 |
| `reference-point[].location_in_frame` | `left` (0–30 %) · `center` (30–70 %) · `right` (70–100 %) — drives alignment correction |
| `parameter_item[]` | Ambient objects; weak evidence only (0.05) |

### Mapping a new building

1. Walk the space and note every fixed landmark: signs (and their exact printed text), wall-mounted TVs, benches, planters, fire hydrants.
2. Create one node per meaningful place, plus `hall` nodes for corridors.
3. Add bidirectional `neighbors` edges with realistic step counts.
4. Give every turning edge a `turn_ref` whose `object_name` matches a real YOLO label and whose `text_content` matches what OCR will actually read (uppercase).
5. Tune `warn_at` / `turn_at` empirically with the simulator's closeness slider — a sign that is 20 % of the frame is roughly "a few steps away."

---

## Accessibility interaction model

The app is designed to be usable with **zero visual feedback**. Everything is press-and-hold, tap counting, and speech.

| Gesture | Action |
|---|---|
| Hold 5 s (before permissions) | Request camera + microphone access, with a spoken countdown |
| Hold 3 s | Start recording a spoken destination; release to transcribe and route |
| Tap 3× | Cancel the current destination and navigation |
| Tap 5× | Switch hospital / reload a different floor plan by voice |

Design rules enforced in the Lumi system prompt:

- Never use sight-dependent verbs ("see", "look", "notice") — say "there is…", "detected…".
- Maximum two sentences per utterance.
- Obstacles must always state **what**, **where**, and **what to do**.
- Turns are announced twice: once in preparation, once at execution.
- Directions are always ซ้าย / ขวา / ตรงไป — never "over there".
- Room and department names keep their real English forms (`OPD`, `X-ray`, `ICU`, `Screening Area`).

The UI does render a high-contrast state panel for sighted helpers and developers, colour-coded by state: `navigating` blue, `arrived` green, `locating` orange, `lost` red, `rerouting` purple, plus live FPS and latency.

---

## Simulator — testing without a building

`frontend/app/simulator.tsx` drives the entire navigation engine from synthetic frames, so you can test event logic at a desk with no camera and no backends except the AI service.

1. Launch the app and open **🧪 SIM**.
2. **Walk To** → `ทางเข้าหลัก` (Main Entrance).
3. **Set Destination** → `จุดลงทะเบียน` (Registration).
4. Watch `route_started` appear in the event log.
5. Drag the **Closeness Tester** slider to cross `warn_at` and `turn_at` and fire `approaching_turn` / `turn_now`.
6. Use **Drift Left / Drift Right** to trigger `alignment_correction`.
7. Walk to a node that is not on the route to trigger `reroute`.
8. Toggle **Obstacles ON** to generate `warning` and `danger` events.

`lib/navigation/simulator.ts` builds detections from a node's `reference-point` list at their correct grid columns, sprinkles in random ambient items, and optionally injects person/chair/dog obstacles. `simulateTransitionFrame()` returns a sparse frame to imitate walking between nodes.

---

## Security notes

Read this before your first push.

- **`.gitignore` already excludes `.env`, `.env.*`, and `google_key.json`** — keep it that way, and verify with `git status` that none of them are staged.
- If a real `OPENROUTER_API_KEY` or Google service-account JSON was ever committed, **rotate both credentials** — revoke the OpenRouter key and delete the service-account key in the Google Cloud console. Removing the file in a later commit does not remove it from history.
- Commit a `backend/ai_service/.env.example` with empty values instead of the real `.env`.
- All three backends currently run with `CORS allow_origins=["*"]` and bind `0.0.0.0`, and none of them authenticate requests. That is fine for a LAN demo; do **not** leave a Cloudflare quick tunnel pointing at them unattended.
- Camera frames are sent to Google Cloud Vision and audio to Google's Web Speech endpoint. In a real hospital deployment this is patient-adjacent data — get consent and check local privacy law before any pilot.
- The repo carries large binaries (`yolo26m.pt` 43 MB, `text_detector.pt` 5 MB, `cloudflared-windows-amd64.exe` 63 MB). Track the model weights with [Git LFS](https://git-lfs.com/) and drop the `cloudflared` executable in favour of a download link — GitHub warns above 50 MB and hard-rejects at 100 MB per file.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| STT crashes with a missing `ffmpeg` error | Install [ffmpeg](https://ffmpeg.org/download.html) and add it to `PATH`. The Docker image already bundles it. |
| `ModuleNotFoundError: No module named 'speech_recognition'` | `pip install SpeechRecognition` — it is imported by `stt_service.py` but missing from `requirements.txt`. |
| Blank screen at `localhost:8081` | Refresh; the Expo web bundler needs a moment on first compile. |
| `DefaultCredentialsError` from the vision service | `google_key.json` is missing or `GOOGLE_VISION` points at the wrong path. |
| Tunnels report `429 Too Many Requests` | Cloudflare quick-tunnel rate limit. Wait a minute and rerun `start_tunnels.ps1`. |
| Phone shows `Network request failed` | `frontend/.env` still points at `localhost`. Rerun `start_tunnels.ps1` and restart the Expo dev server so the new env is bundled. |
| Never leaves the `locating` state | Your map's `reference-point` entries do not match reality. Check the vision service log for the actual OCR strings and YOLO labels, then align `text_content` and `object_name`. |
| Speech is cut off mid-sentence | Expected when a `danger` event arrives — critical priority clears the queue by design. |
| Vision service is slow / low FPS | YOLO is running on CPU. Use `yolo26n.pt` instead of `yolo26m.pt`, or run with CUDA. |

---

## Known limitations & roadmap

- Localization depends entirely on hand-authored landmark lists; a repainted sign or moved TV degrades accuracy.
- The route graph has no elevation or multi-floor pathing yet, although `path_type` already reserves `stairway` and `elevator`.
- Alignment correction uses three horizontal columns only — vertical position and camera tilt are ignored.
- Google Web Speech and Cloud Vision both require connectivity; there is no offline fallback.
- `frontend/app/sound.tsx` still contains a hard-coded LAN IP and targets a `/chat` endpoint that no longer exists; it is a legacy audio scratchpad, not part of the main flow.
- Roadmap ideas: on-device OCR to cut latency, multi-floor routing, a map-authoring tool that generates nodes from a walkthrough video, per-user voice-speed calibration, and an English persona alongside Thai.

---

## Contributing

1. Fork and branch: `git checkout -b feat/your-feature`
2. Keep the event contract in `frontend/lib/navigation/types.ts` and the Thai templates in `backend/ai_service/config.ts` in sync — every new event tag needs a template, a priority, and an intensity hint.
3. Validate behaviour in the simulator before testing on hardware.
4. Run `cd frontend && npm run lint` before opening a PR.
5. Never commit `.env` files, `google_key.json`, or new large binaries.

---

## License

No license file is currently included, which means the work is **all rights reserved** by default. Add a `LICENSE` file — [MIT](https://choosealicense.com/licenses/mit/) is a good default for a portfolio project — if you want others to be able to use it.

---

## Acknowledgements

Built with [Expo](https://expo.dev/), [Ultralytics YOLO](https://docs.ultralytics.com/), [Google Cloud Vision](https://cloud.google.com/vision), [Google Web Speech via SpeechRecognition](https://pypi.org/project/SpeechRecognition/), [OpenRouter](https://openrouter.ai/), and [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/).
