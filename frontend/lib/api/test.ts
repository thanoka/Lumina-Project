import fs from 'fs';
import axios from 'axios';
import FormData from 'form-data';

// 1. Update your Tunnel URL
const SERVER_URL = "https://walls-option-plot-delegation.trycloudflare.com/process-frame";
const TEST_IMAGE_PATH = "./Gemini_Generated_Image_b3r7oob3r7oob3r7.png"; 

// 2. Updated Interfaces to match the new Main.py output
export interface Detection {
  label: string;
  grid_location: string; // Now "top_center", "center_left", etc.
  size_pct: number;      // Used for distance thresholds
  type: "safety" | "text";
  text_content?: string; // Only for "text" type
}

export interface ProcessResponse {
  status: string;
  detections: Detection[];
  can_read_sign: boolean;
  sign_text: string;
}

// 🎯 Mock Thresholds from your JSON data
const THRESHOLDS = {
  WARNING: 0.05,
  ARRIVAL: 0.15
};

async function testBackend() {
  console.log("🚀 Testing Connection to:", SERVER_URL);

  try {
    if (!fs.existsSync(TEST_IMAGE_PATH)) {
      console.error(`❌ Error: Could not find ${TEST_IMAGE_PATH}`);
      return;
    }

    const formData = new FormData();
    formData.append('file', fs.createReadStream(TEST_IMAGE_PATH));

    console.log("📤 Sending image to AI Brain...");
    const response = await axios.post(SERVER_URL, formData, {
      headers: { ...formData.getHeaders() },
    });

    const data: ProcessResponse = response.data;

    console.log("\n--- 🤖 RAW RESPOND FROM MAIN.PY ---");
    console.dir(data, { depth: null });
    console.log("-----------------------------------\n");

    // 🗺️ LOGIC TEST: Simulate Navigation Triggering
    console.log("🧭 NAVIGATION LOGIC TEST:");
    data.detections.forEach((det, index) => {
      const isSign = det.type === "text";
      const info = isSign ? `SIGN ("${det.text_content}")` : det.label;
      
      console.log(`[Item ${index + 1}] Found ${info} at ${det.grid_location}`);
      console.log(`      Size: ${(det.size_pct * 100).toFixed(2)}% of frame`);

      // Test against your data thresholds
      if (det.size_pct >= THRESHOLDS.ARRIVAL) {
        console.log(`      📍 STATUS: ARRIVED (Triggers: "You are at the ${info}")`);
      } else if (det.size_pct >= THRESHOLDS.WARNING) {
        console.log(`      ⚠️ STATUS: WARNING (Triggers: "${info} detected ahead")`);
      } else {
        console.log(`      🔍 STATUS: TRACKING (Object too far)`);
      }
    });

  } catch (error: any) {
    console.error("🔥 Connection Failed!");
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", error.response.data);
    } else {
      console.error("Message:", error.message);
    }
  }
}

testBackend();