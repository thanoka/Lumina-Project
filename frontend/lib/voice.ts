import * as Speech from 'expo-speech';

// ─── Types ──────────────────────────────────────────────────────────────────

export type SpeechPriority = 'critical' | 'high' | 'normal';

export interface EmotionalVoiceParams {
  text: string;
  intensity: number;  // 0.0 – 1.0
  priority?: SpeechPriority;
}

// ─── Voice Tuning Constants ─────────────────────────────────────────────────

const RATE_MIN  = 1.0;
const RATE_MAX  = 1.6;
const PITCH_MIN = 0.9;
const PITCH_MAX = 1.25;

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * Math.max(0, Math.min(1, t));
}

// ─── Speech Queue ───────────────────────────────────────────────────────────
//
// All speech is queued and played sequentially.
// Only "critical" priority (danger/warning) can interrupt:
//   → clears the queue, stops current speech, plays immediately.
// Everything else waits its turn — nothing is skipped.

interface QueueItem {
  text: string;
  intensity: number;
}

const speechQueue: QueueItem[] = [];
let isProcessingQueue = false;

async function processQueue(): Promise<void> {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (speechQueue.length > 0) {
    const item = speechQueue.shift()!;
    await doSpeak(item.text, item.intensity);
  }

  isProcessingQueue = false;
}

/** Low-level speak — waits until this utterance finishes. */
async function doSpeak(text: string, intensity: number): Promise<void> {
  const rate  = parseFloat(lerp(RATE_MIN, RATE_MAX, intensity).toFixed(2));
  const pitch = parseFloat(lerp(PITCH_MIN, PITCH_MAX, intensity).toFixed(2));

  console.log(`🎤 speak | intensity: ${intensity} → rate: ${rate}, pitch: ${pitch}`);

  return new Promise((resolve) => {
    Speech.speak(text, {
      language: 'th-TH',
      rate,
      pitch,
      onDone: () => resolve(),
      onError: (err) => {
        console.warn("Speech error:", err);
        resolve();
      },
    });
  });
}

// ─── Original speak() — unchanged for backward compatibility ────────────────

export const speak = async (text: string): Promise<void> => {
  if (!text) return;

  try {
    await Speech.stop();

    return new Promise((resolve) => {
      Speech.speak(text, {
        language: 'th-TH', 
        rate: 1.2,       
        pitch: 1.2,      
        onDone: () => resolve(),
        onError: (err) => {
          console.warn("Speech error:", err);
          resolve();
        },
      });
    });
  } catch (error) {
    console.error("Critical Speech Failure:", error);
  }
};

export const stopSpeech = async (): Promise<void> => {
  speechQueue.length = 0;
  isProcessingQueue = false;
  await Speech.stop();
};

export const speakWithEmotion = async (params: EmotionalVoiceParams): Promise<void> => {
  const { text, intensity, priority = 'normal' } = params;
  if (!text) return;

  if (priority === 'critical') {
    // ── Interrupt everything — danger/warning takes over ──
    speechQueue.length = 0;       // clear pending queue
    await Speech.stop();          // stop current speech
    isProcessingQueue = false;    // reset queue processor
    console.log(`🔴 [SPEECH] CRITICAL INTERRUPT → speaking immediately`);
    await doSpeak(text, intensity);
    // Resume queue if anything was added during the interrupt
    processQueue();
  } else {
    // ── Queue it — will play after current speech finishes ──
    speechQueue.push({ text, intensity });
    console.log(`📋 [SPEECH] Queued (${speechQueue.length} pending) | priority: ${priority}`);
    processQueue();
  }
};