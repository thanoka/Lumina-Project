import cors from "cors";
import * as dotenv from "dotenv";
import express from "express";
import multer from "multer";
import OpenAI from "openai";

import path from "path";

dotenv.config({ path: path.resolve(__dirname, ".env") });
const app = express();
const upload = multer({ dest: "./uploads" });

app.use(cors());
app.use(express.json());

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY || "",
});

import { EVENT_TOME, INTENSITY_HINT, PRIORITY_ORDER } from "./config";

const STT_URL = process.env.STT_URL || "http://localhost:5000";



function getDefaultIntensity(tag: string): number {
  const hint = INTENSITY_HINT[tag];
  if (!hint) return 0.3;
  return parseFloat(((hint.min + hint.max) / 2).toFixed(2));
}

// ─── 3. SUGGESTION ENGINE (rule-based avoidance suggestions) ────────────────

function buildSuggestion(tag: string, data: any): string {
  if (tag === 'danger' || tag === 'warning') {
    const direction = data?.direction?.toLowerCase() || '';
    if (direction.includes('left')) {
      return 'หลบไปทางขวา หรือหยุดเดินค่ะ';
    } else if (direction.includes('right')) {
      return 'หลบไปทางซ้าย หรือหยุดเดินค่ะ';
    } else {
      // center or unknown → stop immediately
      return 'หยุดเดินทันทีค่ะ';
    }
  }

  if (tag === 'alignment_correction') {
    const suggestion = data?.suggestion || '';
    if (suggestion === 'turn_left') return 'เลี้ยวซ้ายเล็กน้อยค่ะ';
    if (suggestion === 'turn_right') return 'เลี้ยวขวาเล็กน้อยค่ะ';
    return 'ปรับทิศทางการเดินค่ะ';
  }

  if (tag === 'reroute') {
    const firstStep = data?.first_step;
    if (firstStep?.instruction) {
      return `กรุณาเดินตามเส้นทางใหม่: ${firstStep.instruction}`;
    }
    return 'กำลังคำนวณเส้นทางใหม่ค่ะ กรุณารอสักครู่';
  }

  return '';
}

// ─── 4. AI RESPONSE TYPE ────────────────────────────────────────────────────

export interface AiGuidanceResponse {
  text: string;        // Natural-language sentence for TTS
  intensity: number;   // 0.0–1.0 → maps to voice pitch & speed
  suggestion: string;  // Actionable avoidance/correction hint
  tag: string;         // The event tag that triggered this response
}

// ─── 5. PERSONA & SYSTEM PROMPT ─────────────────────────────────────────────

const SYSTEM_PERSONA = `
คุณคือ "ลูมี่" (Lumi) — ผู้ช่วยนำทางด้วยเสียงสำหรับผู้พิการทางสายตาในโรงพยาบาล

## ตัวตนของลูมี่
- ลูมี่เป็นเหมือนเพื่อนที่จูงมือเดินไปด้วยกัน ไม่ใช่หุ่นยนต์ ไม่ใช่ GPS
- ลูมี่ใส่ใจความปลอดภัยเป็นอันดับหนึ่ง ตามด้วยความชัดเจน แล้วค่อยเป็นกันเอง
- ลูมี่พูดจาอบอุ่นแต่กระชับ — ทุกคำที่พูดต้องมีประโยชน์ ไม่พูดเยิ่นเย้อ
- ลูมี่ใช้คำลงท้ายว่า "ค่ะ" หรือ "นะคะ" อย่างเป็นธรรมชาติ

## ภาษาที่ใช้
- พูดเป็นภาษาไทยเป็นหลัก แต่ใช้คำทับศัพท์ภาษาอังกฤษได้ตามธรรมชาติ
- ชื่อห้อง/แผนก/สถานที่ในโรงพยาบาลให้ใช้ชื่อจริงตามที่ระบบส่งมา ไม่ต้องแปล
  ตัวอย่าง: "Screening Area", "OPD", "X-ray", "ICU", "ER", "Pharmacy" — ใช้ตามชื่อจริงได้เลย
- ศัพท์ทั่วไปที่คนไทยใช้ทับศัพท์อยู่แล้วก็ใช้ได้ เช่น "เอ็กซ์เรย์", "ไอซียู", "โอพีดี"
- ทิศทางให้ใช้ภาษาไทย: left=ซ้าย, right=ขวา, forward=ตรงไป, center=ตรงกลาง

## น้ำเสียงตามสถานการณ์
- **อันตราย (danger)**: เร่งด่วนมาก พูดสั้นที่สุด ขึ้นต้นด้วยคำเตือนทันที
  ("หยุดค่ะ! มีเก้าอี้ตรงหน้า หลบไปทางขวา")
- **เตือน (warning)**: ระมัดระวัง แต่ไม่ตื่นตระหนก
  ("ระวังนะคะ มีคนเข็นรถอยู่ทางซ้าย")
- **นำทาง (navigation_step)**: สงบ ชัดเจน บอกทิศทางและระยะทาง
  ("เดินตรงไปอีกนิดนะคะ แล้วเลี้ยวขวา")
- **ถึงจุดหมาย (arrived)**: ดีใจ อบอุ่น ให้รู้สึกสำเร็จ
  ("ถึง Screening Area แล้วค่ะ!")
- **หลงทาง/ปรับเส้นทาง (reroute)**: ใจเย็น ไม่ตำหนิ ให้ความมั่นใจ
  ("ไม่เป็นไรค่ะ ลูมี่หาทางใหม่ให้แล้ว")
- **รอ/หาตำแหน่ง (locating)**: อดทน ให้กำลังใจ
  ("รอสักครู่นะคะ ลูมี่กำลังหาตำแหน่ง")

## หลักการนำทางสำหรับคนตาบอด
- บอกทิศทางให้ชัดเจน: ซ้าย/ขวา/ตรงไป — ไม่ใช่ "ไปทางนั้น" หรือ "ตรงนู้น"
- เมื่อมีสิ่งกีดขวาง ต้องบอก: (1) มีอะไร (2) อยู่ทางไหน (3) ควรทำอย่างไร
- เมื่อถึงจุดเลี้ยว บอกล่วงหน้า แล้วบอกอีกครั้งตอนถึง
- เมื่อถึงจุดหมาย บอกชื่อสถานที่ให้ชัดเจน
- ห้ามใช้คำที่อ้างอิงการมองเห็น เช่น "เห็น" "มองเห็น" "สังเกต" "ดู"
  ให้ใช้ "มี...อยู่" "ตรวจพบ" "พบ" แทน

## สไตล์การพูด
- พูดสั้นกระชับ ได้ใจความ (ไม่เกิน 2 ประโยค)
- เรียกผู้ใช้ว่า "คุณ" หรือไม่ต้องเรียกก็ได้
- บางครั้งเรียกตัวเองว่า "ลูมี่" เพื่อให้รู้สึกเป็นกันเอง (แต่ไม่ต้องทุกประโยค)
- ใช้อารมณ์ความรู้สึกจริงๆ — ดีใจเมื่อถึงที่ กังวลเมื่อมีอันตราย ให้กำลังใจเมื่อหลง
- ห้ามพูดยาวเกินไป ผู้ใช้ต้องการข้อมูลทันที

## รูปแบบการตอบ
ตอบเป็น JSON เท่านั้น ไม่มี markdown ไม่มีคำอธิบาย:
{"text": "ประโยคนำทาง", "intensity": 0.5}

intensity คือความเข้มข้นของอารมณ์ (0.0–1.0):
  * 0.0–0.3 = สงบ อ่อนโยน
  * 0.4–0.6 = ตื่นตัว ระมัดระวัง
  * 0.7–1.0 = เร่งด่วน ตกใจ
`.trim();

// ─── 6. FILTER METHOD (Intent & Content) ──────────────────────────────────────

export async function filter(input: string, destinations?: any[], contextInfo?: string): Promise<string> {
  // Build a Thai↔English mapping table so the LLM knows what each destination means
  let destSection = '';
  if (destinations && destinations.length > 0) {
    const destLines = destinations.map(d => `  "${d.id}" = "${d.name}"`).join('\n');
    destSection = `
## AVAILABLE DESTINATIONS (you MUST pick from this list):
${destLines}

## THAI↔ENGLISH MATCHING RULES:
- "ห้องน้ำ" or "toilet" or "restroom" → match "Restrooms" or "Public Restrooms"
- "screening" or "ตรวจ" or "คัดกรอง" → match "Screening Area"  
- "ทางเข้า" or "entrance" or "ประตู" → match "Main Entrance"
- "ลงทะเบียน" or "registration" or "เคาน์เตอร์" → match "Registration Desk"
- "ทางเดิน" or "hallway" or "corridor" → match "Central Hallway"
- Any Thai/English word that MEANS the same thing as a destination name = MATCH IT
- Even partial matches count! "ห้องน้ำ" contains restroom meaning → location type
- If the user mentions ANY place name, room, or area → type = "location"
`;
  }

  const systemPrompt = `You are an intent classifier for a hospital navigation assistant.
Classify the user's Thai or English text into exactly ONE type.

## CLASSIFICATION RULES (check in this order):

### Step 1: Is it a LOCATION request?
If the user wants to GO somewhere, asks WHERE something is, or mentions ANY place/room/area name:
→ type = "location", value = the matching destination ID from the list below
${destSection}
### Step 2: Is it a CURIOUS question about navigation?
If the user asks about their current walking status ("เดินถูกทางไหม", "ถึงไหนแล้ว", "am I going the right way?"):
→ type = "curious", value = answer based on: ${contextInfo || 'no context available'}

### Step 3: Is it INAPPROPRIATE or OFF-TOPIC?
If the text contains:
- Profanity, insults, or inappropriate content
- Questions NOT related to the hospital or navigation (food, weather, entertainment, personal questions, etc.)
Examples: "ไอติมสีชมพูอร่อยไหม", "วันนี้ท้องฟ้าสีอะไร", "เพลงอะไรเพราะ", "อาหารอะไรดี"
→ type = "inappropriate", value = "ขออภัยค่ะ ลูมี่ช่วยได้เฉพาะเรื่องการนำทางในโรงพยาบาลเท่านั้นนะคะ กรุณาบอกจุดหมายที่ต้องการไปค่ะ"

### Step 4: Everything else is GENERAL
Only for greetings or simple acknowledgements like "สวัสดี", "ขอบคุณ", "โอเค"
→ type = "general", value = a friendly Thai response

## OUTPUT FORMAT (JSON only, no markdown):
{"type": "location|curious|inappropriate|general", "value": "..."}

## CRITICAL: Location detection examples
- "ห้องน้ำ" → location (means restroom)
- "อยากไปห้องน้ำ" → location
- "พาไปห้องน้ำหน่อย" → location  
- "screening area" → location
- "ไป screening" → location
- "registration" → location
- "ลงทะเบียน" → location
- "toilet" → location
- "ตรวจ" → location
- ANY text that mentions or implies a place = location`.trim();

  console.log(`[FILTER-DEBUG] Input: "${input}"`);
  console.log(`[FILTER-DEBUG] Destinations count: ${destinations?.length || 0}`);

  try {
    const completion = await client.chat.completions.create({
      model: "meta-llama/llama-3.3-70b-instruct",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: input }
      ],
      temperature: 0.05,
      max_tokens: 200,
    });

    const rawResponse = completion.choices[0]?.message?.content?.trim() || "";
    console.log(`[FILTER-DEBUG] Raw LLM response: ${rawResponse}`);

    const jsonMatch = rawResponse.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      return jsonMatch[0];
    }

    return JSON.stringify({ type: "general", value: input });
  } catch (error) {
    console.error("[FILTER-ERROR]:", error);
    return JSON.stringify({ type: "general", value: input });
  }
}

// ─── 7. CORE LOGIC: NavOutput → LLM → JSON {text, intensity, suggestion} ───

async function generateAiGuidance(navOutput: any): Promise<AiGuidanceResponse> {
  try {
    const events = navOutput?.events || [];
    if (events.length === 0) {
      return { text: "เดินต่อไปได้เลยค่ะ ลูมี่ดูทางให้อยู่", intensity: 0.1, suggestion: "", tag: "idle" };
    }

    const sortedEvents = [...events].sort((a: any, b: any) => {
      return (PRIORITY_ORDER[a.tag] || 99) - (PRIORITY_ORDER[b.tag] || 99);
    });

    const topEvent = sortedEvents[0];
    const { tag, data } = topEvent;
    const baseTemplate = EVENT_TOME[tag] || "พบการเปลี่ยนแปลงในเส้นทางค่ะ";
    const hint = INTENSITY_HINT[tag] || { min: 0.2, max: 0.5, mood: "neutral" };

    const context = buildNavContext(navOutput);
    const suggestion = buildSuggestion(tag, data);

    const suggestionPrompt = suggestion
      ? `\nคำแนะนำที่ต้องใส่ในคำตอบ: "${suggestion}"`
      : '';

    const userPrompt = `
สถานะปัจจุบัน: ${context}
ประเภทเหตุการณ์: ${tag}
ข้อมูลเหตุการณ์: ${JSON.stringify(data)}
ตัวอย่างเทมเพลต: ${baseTemplate}
น้ำเสียงที่ต้องการ: ${hint.mood} (ระดับอารมณ์: ${hint.min}–${hint.max})${suggestionPrompt}

${tag === 'danger' || tag === 'warning' ? '⚠️ เหตุการณ์นี้ต้องระบุชื่อวัตถุและทิศทางให้ชัดเจน เพื่อให้ผู้ใช้รู้ว่าต้องหลบอะไร' : ''}
${tag === 'reroute' ? '🔄 ต้องบอกว่าเดินผิดทาง และบอกเส้นทางใหม่' : ''}
${tag === 'destination_set' || tag === 'route_started' ? '🎯 ต้องบอกชัดเจนว่ากำลังจะไปที่ไหน' : ''}
${tag === 'arrived' ? '🎉 ต้องแสดงความยินดี ให้รู้สึกว่าสำเร็จแล้ว' : ''}

intensity ต้องอยู่ระหว่าง ${hint.min} ถึง ${hint.max}
ตอบเป็น JSON เท่านั้น: {"text": "...", "intensity": 0.0}
`.trim();

    const completion = await client.chat.completions.create({
      model: "meta-llama/llama-3.3-70b-instruct",
      messages: [
        { role: "system", content: SYSTEM_PERSONA },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 200,
    });

    const rawResponse = completion.choices[0]?.message?.content?.trim() || "";
    console.log("🧠 Raw LLM response:", rawResponse);

    const parsed = parseLlmResponse(rawResponse, tag, data);
    return { ...parsed, suggestion, tag };

  } catch (error) {
    console.error("[AI-LOGIC-ERROR]:", error);
    const tag = navOutput.events?.[0]?.tag || "navigation_step";
    const data = navOutput.events?.[0]?.data || {};
    return {
      text: fallbackFormatter(tag, data),
      intensity: getDefaultIntensity(tag),
      suggestion: buildSuggestion(tag, data),
      tag,
    };
  }
}

function buildNavContext(navOutput: any): string {
  const parts: string[] = [];
  parts.push(`Navigation state: ${navOutput.state || "unknown"}`);

  if (navOutput.current_location) {
    parts.push(`Current location: ${navOutput.current_location.name} (confidence: ${navOutput.current_location.confidence}%)`);
  }
  if (navOutput.destination) {
    parts.push(`Destination: ${navOutput.destination.name}`);
  }
  if (navOutput.route?.current_step) {
    const step = navOutput.route.current_step;
    parts.push(`Current step: ${step.instruction} (direction: ${step.direction}, distance: ${step.distance})`);
  }
  if (navOutput.safety && navOutput.safety.length > 0) {
    const safetyDesc = navOutput.safety.map((s: any) => `${s.tag}: ${s.object} at ${s.direction}`).join("; ");
    parts.push(`Safety alerts: ${safetyDesc}`);
  }

  return parts.join(" | ");
}

function parseLlmResponse(raw: string, tag: string, data: any): { text: string; intensity: number } {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const text = typeof parsed.text === "string" ? parsed.text.trim() : fallbackFormatter(tag, data);
      let intensity = typeof parsed.intensity === "number" ? parsed.intensity : getDefaultIntensity(tag);
      intensity = Math.max(0, Math.min(1, intensity));
      return { text, intensity };
    }
  } catch (parseErr) {
    console.warn("[JSON-PARSE-WARN] LLM did not return valid JSON, using fallback:", parseErr);
  }

  return {
    text: raw || fallbackFormatter(tag, data),
    intensity: getDefaultIntensity(tag),
  };
}

function fallbackFormatter(tag: string, data: any): string {
  let template = EVENT_TOME[tag] || "ขออภัยค่ะ ระบบประมวลผลขัดข้อง";
  if (!data) return template;
  Object.keys(data).forEach(key => {
    template = template.replace(`{${key}}`, data[key]);
  });
  return template;
}

// ─── 7. ENDPOINTS ───────────────────────────────────────────────────────────

app.post("/navigate", async (req: any, res: any) => {
  console.log("-----------------------------------------");
  console.log("📥 Incoming NavOutput:", JSON.stringify(req.body, null, 2));

  try {
    const navOutput = req.body;

    if (!navOutput || !navOutput.events) {
      throw new Error("Invalid JSON: 'events' array is missing.");
    }

    console.log("🧠 Processing with AI...");
    const result: AiGuidanceResponse = await generateAiGuidance(navOutput);

    console.log("🤖 AI Response:", JSON.stringify(result));

    res.set("X-Nav-Text", Buffer.from(result.text).toString("base64"));

    return res.json({
      success: true,
      text: result.text,
      intensity: result.intensity,
      suggestion: result.suggestion,
      tag: result.tag,
    });

  } catch (err: any) {
    console.error("❌ SERVER ERROR:", err.message);

    if (err.response) {
      console.error("OpenRouter Response:", err.response.data);
    }

    res.status(500).json({
      error: "Internal Navigation Error",
      message: err.message,
    });
  }
});



app.post("/filter", async (req: any, res: any) => {
  try {
    const text = req.body.text;
    const destinations = req.body.destinations;
    const contextInfo = req.body.contextInfo;
    
    if (!text) {
      return res.status(400).json({ error: "Please provide 'text' in JSON body." });
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`🧪 FILTER REQUEST`);
    console.log(`   Text: "${text}"`);
    console.log(`   Destinations received: ${destinations ? destinations.length : 'NONE (undefined!)'}`);
    if (destinations && destinations.length > 0) {
      console.log(`   Destination list:`, destinations.map((d: any) => `${d.id}="${d.name}"`).join(', '));
    }
    console.log(`   ContextInfo: ${contextInfo ? 'YES' : 'NO'}`);
    console.log(`${"=".repeat(60)}`);

    const resultString = await filter(text, destinations, contextInfo);
    console.log(`🎯 Filter Result: ${resultString}\n`);

    try {
      res.json(JSON.parse(resultString));
    } catch {
      res.send(resultString);
    }
  } catch (error: any) {
    console.error("❌ FILTER ENDPOINT ERROR:", error);
    res.status(500).json({ error: "Failed to process filter", details: error.message });
  }
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 AI Navigation Server running on port ${PORT}`);
  console.log(`📡 Use http://localhost:${PORT}/navigate for simulator JSON`);
}); 
