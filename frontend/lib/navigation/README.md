# 🧭 Navigation System for Blind Users

## Overview

This navigation system uses **YOLO object detection + Google Vision OCR** (the "Eyes" server) to determine a blind user's position inside a building, then provides structured JSON events for an **LLM** to convert into friendly Thai voice guidance.

The system does **NOT** speak directly. It outputs JSON events with tags that the LLM reads and transforms into natural language.

---

## Architecture

```
Camera Frame → Eyes Server (YOLO + OCR) → NavigationEngine → JSON Events → LLM → Thai Voice
```

### Files

| File | Role |
|------|------|
| `types.ts` | TypeScript interfaces (Detection, TurnRef, Neighbor, NavStep…) |
| `locationMatcher.ts` | Weighted scoring engine — matches detections to map nodes |
| `routePlanner.ts` | BFS shortest path + turn-aware instruction generation |
| `safetyAnnouncer.ts` | Proximity obstacle detection (warning / danger) |
| `navigationEngine.ts` | Central orchestrator — produces `NavOutput` JSON per frame |
| `simulator.ts` | Mock frame generator for offline testing |
| `data/data-mock.json` | Building map graph (nodes, edges, ref points, turn refs) |

---

## Map JSON Structure (`data-mock.json`)

The map is a **flat array of `LocationNode` objects**. Each node represents a physical place (lobby, desk, hallway). Nodes connect to each other via `neighbors` edges, forming a walkable graph.

### Complete Node Schema

```json
{
  "id":   "GF_Main_Entrance",        // Unique ID (used for routing)
  "name": "Main Entrance",           // Human-readable name (for voice)
  "type": "place",                   // "place" | "hall" | "end"

  "neighbors": [ ... ],              // Edges to other nodes (see below)
  "reference-point": [ ... ],        // Landmark objects that IDENTIFY this location
  "parameter_item": [ ... ],         // Ambient objects commonly seen here
  "instruction_on_arrival": "...",    // Thai text spoken when user arrives
  "mtype": "high_ceiling_lobby"      // Physical environment type (for LLM context)
}
```

### Node Types

| `type` | Meaning | Example |
|--------|---------|---------|
| `place` | A destination the user can navigate TO | Registration Desk, Screening Area |
| `hall` | A pass-through corridor (waypoint, not a destination) | Central Hallway |
| `end` | A terminal node (dead end, no through-route) | Restrooms |

### `neighbors[]` — Edges Between Nodes

Each neighbor defines a walkable connection to another node.

```json
{
  "target_id": "GF_Registration",       // Which node this edge leads to
  "direction": "left",                  // Walking direction: "forward" | "backward" | "left" | "right"
  "distance_approx": "15 ก้าว",        // Estimated distance in Thai (steps)
  "path_type": "open_foyer",           // Environment type for the path
  "turn_ref": { ... }                  // (Optional) Landmark that triggers a turn — see below
}
```

**`direction` values:**

| Direction | Meaning |
|-----------|---------|
| `forward` | Walk straight ahead |
| `backward` | Turn around 180° |
| `left` | Turn left at a landmark |
| `right` | Turn right at a landmark |

**`path_type` values:**

| Path Type | Thai Translation | Meaning |
|-----------|-----------------|---------|
| `open_foyer` | ผ่านห้องโถง | Open lobby area |
| `open_hall` | ผ่านทางเดินกว้าง | Wide hallway |
| `corridor` | ผ่านทางเดิน | Narrow corridor |
| `stairway` | ขึ้นบันได | Stairs |
| `elevator` | ใช้ลิฟต์ | Elevator |

### `turn_ref` — Turn Trigger Landmark

Only present on **non-forward edges** (left/right turns). This tells the engine WHEN to tell the user to turn, based on how big a landmark appears in the camera.

```json
{
  "object_name": "sign",                      // YOLO label to look for
  "text_content": "REGISTRATION & ADMISSION", // OCR text to match (optional)
  "warn_at": 0.20,                            // size_pct threshold → "approaching_turn" event
  "turn_at": 0.30,                            // size_pct threshold → "turn_now" event
  "description": "Registration desk sign"     // Human note (not used by engine)
}
```

**How thresholds work:**

```
User walks forward → landmark appears small in camera → grows bigger as user approaches

  size_pct = 5%   → too far, no event
  size_pct = 20%  → warn_at reached → "approaching_turn" → LLM: "Prepare to turn left"
  size_pct = 30%  → turn_at reached → "turn_now"          → LLM: "Turn left now!"
```

### `reference-point[]` — Location Identity Markers

These are the **fixed physical landmarks** that identify WHERE the user is. The engine matches camera detections against these to determine position.

```json
{
  "object_name": "sign",           // YOLO label (what the camera detects)
  "text_content": "MAIN ENTRANCE", // OCR text on the sign (optional)
  "priority": 1,                   // 1 = most important, 3 = weakest signal
  "description": "...",            // Human note (optional)
  "location_in_frame": "center"    // Expected horizontal position: "left" | "center" | "right"
}
```

**Priority scoring** (used by `locationMatcher.ts`):

| Priority | Weight multiplier | Typical object |
|----------|-------------------|----------------|
| 1 | × 1.0 | Main sign with text |
| 2 | × 0.5 | Secondary landmark (TV, fire hydrant) |
| 3 | × 0.33 | Tertiary landmark (bench, clock) |

**`location_in_frame`** — Expected Grid Position:

```
┌──────────────┬──────────────┬──────────────┐
│              │              │              │
│    LEFT      │   CENTER     │    RIGHT     │
│   (col -1)   │   (col 0)    │   (col +1)   │
│              │              │              │
│   0% – 30%   │  30% – 70%   │  70% – 100%  │
└──────────────┴──────────────┴──────────────┘
```

This is used for **alignment correction**. If the sign "MAIN ENTRANCE" should be at `center` but the camera sees it at `left`, the engine knows the user has drifted.

### `parameter_item[]` — Ambient Objects

Common objects expected at this location. Used as a **weak signal** for location matching (only 0.05 weight). These objects can appear anywhere — no specific grid position required.

```json
{
  "object_name": "potted plant",    // YOLO label
  "count": "4 unit",                // How many exist (informational only)
  "text_content": "PULL TO OPEN",   // Text on this object (optional)
  "description": "Large floor planters"  // Human note
}
```

### Full Example Node

```json
{
  "id": "GF_Main_Entrance",
  "name": "Main Entrance",
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
        "turn_at": 0.30,
        "description": "Registration desk sign — when it fills frame, turn left"
      }
    },
    {
      "target_id": "GF_Central_Hall",
      "direction": "forward",
      "distance_approx": "20 ก้าว",
      "path_type": "open_hall"
    }
  ],
  "reference-point": [
    { "object_name": "sign", "text_content": "MAIN ENTRANCE", "priority": 1, "location_in_frame": "center" },
    { "object_name": "tv", "priority": 2, "description": "Wall-mounted Display", "location_in_frame": "center" },
    { "object_name": "bench", "priority": 3, "description": "Stone bench", "location_in_frame": "left" }
  ],
  "parameter_item": [
    { "object_name": "potted plant", "count": "4 unit", "description": "Large fixed floor planters" },
    { "object_name": "chair", "count": "10 unit", "description": "Fixed metal waiting chairs" }
  ],
  "instruction_on_arrival": "You have reached the Main Entrance lobby.",
  "mtype": "high_ceiling_lobby"
}
```

---

## How Each Function Works

### 1. `locationMatcher.ts` — Where Am I?

**Purpose:** Takes camera detections and scores every map node to find the best match.

**Function: `getBestMatch(detections, mapNodes) → LocationMatch | null`**

Steps:
1. For each node, calculate a weighted score:
   - **Sign text exact match** → +0.50 × (1/priority)
   - **Sign text partial match** → +0.30 × (1/priority)
   - **Object label + correct grid** → +0.20 × (1/priority)
   - **Object label only** (wrong grid) → +0.10 × (1/priority)
   - **Ambient object seen** → +0.05
2. Normalize all scores so the highest = 1.0
3. Filter out anything below 15% confidence
4. Return the top scorer

**Synonym support:** `tv` = `monitor` = `screen`, `dining table` = `desk`, etc.

### 2. `routePlanner.ts` — How Do I Get There?

**Purpose:** Finds the shortest path between two nodes and generates Thai instructions.

**Function: `planRoute(mapNodes, sourceId, destId) → Route | null`**

Steps:
1. Build adjacency map from all nodes
2. Run **BFS** (breadth-first search) from source to destination
3. For each step in the path:
   - Look up the edge (direction, distance, path_type, turn_ref)
   - Generate Thai instruction text
   - If the step has a `turn_ref`, the instruction says "walk forward, when you see [landmark], turn [direction]"

**Function: `getNodeById(mapNodes, nodeId) → LocationNode`**
**Function: `getDestinations(mapNodes) → { id, name }[]`**

### 3. `safetyAnnouncer.ts` — Is Anything Dangerous?

**Purpose:** Checks every detection for proximity danger based on `size_pct`.

**Function: `processSafetyDetections(detections) → SafetyAlert[]`**

| `size_pct` | Result |
|-----------|--------|
| < 5% | Ignored (too far) |
| 5% – 15% | `warning` event |
| ≥ 15% | `danger` event |

- Has a **5-second cooldown** per object+grid combo to prevent spam
- Results sorted: dangers first, then by size (biggest = closest)

### 4. `navigationEngine.ts` — The Brain

**Purpose:** Orchestrates everything. Receives one frame, runs the full pipeline, returns structured JSON.

**Function: `processFrame(frameData) → NavOutput`**

The pipeline runs **8 steps** every frame:

```
Step 1: Safety Check
  └─ processSafetyDetections() → warning/danger events

Step 2: Location Matching
  └─ getBestMatch() → find current node
  └─ Needs confidence ≥ 40%
  └─ Must match 2 consecutive frames (stability check)

Step 3: Route Planning Trigger
  └─ If state is "locating" and location found → auto-plan route

Step 4: Route Progress
  └─ If navigating → check if user reached next step/waypoint/destination
  └─ If off-route → auto-reroute with BFS

Step 5: Turn Ref Monitoring
  └─ If current step has turn_ref → check if landmark is visible
  └─ size_pct ≥ warn_at → "approaching_turn" (fires once)
  └─ size_pct ≥ turn_at → "turn_now" (fires once)

Step 6: Sign Reading
  └─ If unknown sign text detected → "sign_read" event (5s cooldown)

Step 7: Alignment Correction
  └─ Compare reference-point expected grid vs detected grid
  └─ If misaligned → "alignment_correction" with direction suggestion
  └─ 3-second cooldown per object to prevent spam
  └─ Sign at LEFT, expected CENTER → suggest "turn_right"
  └─ Sign at RIGHT, expected CENTER → suggest "turn_left"

Step 8: Guidance
  └─ If locating for >4s with no match → "guidance_needed"
```

**Other public methods:**

| Method | What it does |
|--------|-------------|
| `setDestination(destId)` | Sets target, auto-plans route if location known |
| `cancelNavigation()` | Resets to idle state |
| `getState()` | Returns current NavState |
| `getCurrentLocation()` | Returns last known node ID |
| `getRoute()` | Returns current Route object |

### 5. `simulator.ts` — Fake Frames for Testing

**Purpose:** Generates mock `FrameResponse` data without needing a real camera.

**Function: `simulateFrame(node, includeObstacles) → FrameResponse`**

- Creates detections from the node's `reference-point` array (correct grid positions)
- Randomly includes some `parameter_item` objects
- If `includeObstacles` = true, adds random person/chair/dog detections

**Function: `simulateTransitionFrame() → FrameResponse`**

- Returns a sparse frame (few/no useful detections) to simulate walking between nodes

---

## NavOutput JSON Format

Every call to `processFrame()` returns:

```json
{
  "state": "navigating",
  "current_location": { "id": "GF_Main_Entrance", "name": "Main Entrance", "confidence": 85 },
  "destination":      { "id": "GF_Registration",  "name": "Registration Desk" },
  "route": {
    "step_index": 0,
    "total_steps": 1,
    "current_step": {
      "direction":   "left",
      "distance":    "15 ก้าว",
      "path_type":   "open_foyer",
      "from":        "GF_Main_Entrance",
      "to":          "GF_Registration",
      "instruction": "เริ่มต้น เดินตรงไปข้างหน้า ผ่านห้องโถง เมื่อเห็น \"REGISTRATION & ADMISSION\" ให้เลี้ยวซ้าย ประมาณ 15 ก้าว",
      "turn_ref": {
        "object_name": "sign",
        "text_content": "REGISTRATION & ADMISSION",
        "warn_at": 0.20,
        "turn_at": 0.30
      }
    }
  },
  "safety": [],
  "events": [...]
}
```

---

## Navigation States

| State | Meaning |
|-------|---------|
| `idle` | No destination set |
| `locating` | Destination set, finding current position |
| `navigating` | Following a route step-by-step |
| `arrived` | Destination reached |
| `lost` | Cannot determine position |
| `rerouting` | Off-route, recalculating |

---

## Event Tags

| Tag | When | Key Data |
|-----|------|----------|
| `location_update` | User position changed | `location_id`, `confidence` |
| `navigation_step` | New instruction issued | `direction`, `distance`, `instruction`, `turn_ref` |
| `waypoint_reached` | Passed intermediate node | `waypoint_name`, `arrival_message` |
| `arrived` | Reached destination | `location_name`, `arrival_message` |
| `reroute` | Off-route, new path | `new_total_steps`, `first_step` |
| **`approaching_turn`** | `turn_ref` visible at `warn_at` | `direction`, `landmark`, `size_pct` |
| **`turn_now`** | `turn_ref` visible at `turn_at` | `direction`, `landmark`, `size_pct` |
| `warning` | Object 5–15% of frame | `object`, `direction`, `size_pct` |
| `danger` | Object ≥15% of frame | `object`, `direction`, `size_pct` |
| `alignment_correction` | Ref object off expected column | `expected_grid`, `detected_grid`, `suggestion` |
| `sign_read` | Unknown sign detected | `text` |
| `guidance_needed` | Cannot locate user | `seconds_searching` |
| `destination_set` | Dest set, finding position | `destination_name` |
| `route_started` | Route calculated | `total_steps`, `first_step` |
| `already_there` | User at chosen dest | `location_name` |
| `no_route` | No path found | `destination_name` |
| `navigation_cancelled` | User cancelled | — |

---

## Alignment Correction

The engine uses **3 horizontal columns**. Height is ignored.

```
┌──────────┬──────────┬──────────┐
│  LEFT    │  CENTER  │  RIGHT   │
│ col = -1 │ col = 0  │ col = +1 │
└──────────┴──────────┴──────────┘
```

Each frame, the engine checks if reference objects appear in their expected column:

| Detected | Expected | Suggestion | Reasoning |
|----------|----------|------------|-----------|
| `left` | `center` | `turn_right` | User drifted right → sign shifted left → correct by turning right |
| `right` | `center` | `turn_left` | User drifted left → sign shifted right → correct by turning left |
| `center` | `center` | *(no event)* | Aligned ✅ |

**Cooldown:** Max one correction event per object every 3 seconds.

---

## LLM Integration

### Event priority for voice

1. `danger` — Speak immediately
2. `warning` — Safety note
3. `turn_now` — Execute the turn
4. `approaching_turn` — Prepare
5. `alignment_correction` — Gentle nudge
6. `navigation_step` / `reroute` — Direction update
7. `arrived` — Celebration
8. `location_update` / `sign_read` — Informational

### Example LLM input/output

```json
[{ "tag": "approaching_turn", "data": { "direction": "left", "landmark": "REGISTRATION & ADMISSION", "size_pct": 0.22 }}]
```
→ LLM: *"เริ่มเตรียมตัวเลี้ยวซ้ายได้แล้วค่ะ เห็นป้าย Registration ข้างหน้าแล้ว!"*

```json
[{ "tag": "turn_now", "data": { "direction": "left", "landmark": "REGISTRATION & ADMISSION", "size_pct": 0.31 }}]
```
→ LLM: *"เลี้ยวซ้ายเลยค่ะ! ตอนนี้เลย!"*

---

## How to Test (Simulator)

1. Open app → tap 🧪 **SIM**
2. **Walk To** "Main Entrance"
3. **Set Destination** "Registration Desk"
4. Watch route_started event in the log
5. Use **Closeness Tester** slider to trigger approaching_turn / turn_now
6. Use **Drift Left / Drift Right** to test alignment_correction
7. Walk off-route to test reroute
8. Toggle **Obstacles ON** to test warning / danger

---

## Changing the Server URL

Edit **`.env`** — only one place:

```env
EXPO_PUBLIC_SERVER_URL=https://your-new-url.trycloudflare.com/process-frame
```
