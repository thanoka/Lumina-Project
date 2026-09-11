import { Audio } from "expo-av";
import * as Haptics from "expo-haptics";
import React, { useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { speak } from "../lib/voice";

const LOCAL_IP = "192.168.1.113"; // ← เปลี่ยนเป็น IP เซิร์ฟเวอร์
const SERVER_URL = `http://${LOCAL_IP}:3000/chat`;

const TAPS_REQUIRED = 3;
const INTRO_MSG = `กรุณาแตะหน้าจอ ${TAPS_REQUIRED} ครั้งเพื่อเริ่มพูด`;

const SILENCE_THRESHOLD_DB = -40;
const SILENCE_DURATION_MS = 2000;
const MAX_RECORD_MS = 8000;

export default function HomeScreen() {
  const [status, setStatus] = useState(INTRO_MSG);
  const [loading, setLoading] = useState(false);
  const tapCount = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => {
      speak(INTRO_MSG);
    }, 800);
    return () => clearTimeout(t);
  }, []);

  const recordWithSilenceDetection = (): Promise<string> =>
    new Promise(async (resolve, reject) => {
      const recording = new Audio.Recording();
      try {
        await recording.prepareToRecordAsync({
          isMeteringEnabled: true,
          android: {
            extension: ".m4a",
            outputFormat: Audio.AndroidOutputFormat.MPEG_4,
            audioEncoder: Audio.AndroidAudioEncoder.AAC,
            sampleRate: 16000,
            numberOfChannels: 1,
            bitRate: 128000,
          },
          ios: {
            extension: ".wav",
            outputFormat: Audio.IOSOutputFormat.LINEARPCM,
            audioQuality: Audio.IOSAudioQuality.HIGH,
            sampleRate: 16000,
            numberOfChannels: 1,
            bitRate: 128000,
            linearPCMBitDepth: 16,
            linearPCMIsBigEndian: false,
            linearPCMIsFloat: false,
          },
          web: { mimeType: "audio/wav", bitsPerSecond: 128000 },
        });

        let silenceStart: number | null = null;
        let stopped = false;

        const stop = async (reason: string) => {
          if (stopped) return;
          stopped = true;
          console.log(`[REC] stop: ${reason}`);
          recording.setOnRecordingStatusUpdate(null);
          clearTimeout(maxTimer);
          try {
            await recording.stopAndUnloadAsync();
            const uri = recording.getURI();
            if (uri) resolve(uri);
            else reject(new Error("ไม่สามารถได้ไฟล์เสียง"));
          } catch (e) {
            reject(e);
          }
        };

        const maxTimer = setTimeout(() => stop("max duration"), MAX_RECORD_MS);

        recording.setOnRecordingStatusUpdate((st) => {
          if (!st.isRecording) return;
          const db = st.metering ?? -160;
          const now = Date.now();
          if (db < SILENCE_THRESHOLD_DB) {
            if (silenceStart === null) silenceStart = now;
            else if (now - silenceStart >= SILENCE_DURATION_MS) stop("silence");
          } else {
            silenceStart = null;
          }
        });

        await recording.startAsync();
      } catch (e) {
        reject(e);
      }
    });

  const handlePress = async () => {
    if (loading) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    tapCount.current += 1;
    const remaining = TAPS_REQUIRED - tapCount.current;

    if (remaining > 0) {
      const msg = `แตะอีก ${remaining} ครั้ง`;
      setStatus(msg);
      speak(msg); // ← voice.ts
      return;
    }

    tapCount.current = 0;
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert("ต้องการสิทธิ์ไมค์", "กรุณาอนุญาตการใช้ไมค์ในการตั้งค่า");
        return;
      }

      // 1) พูดถามก่อน แล้วค่อยบันทึก
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
      setStatus("💬 กำลังพูดถาม...");
      await speak("มีอะไรให้ช่วยไหมคะ"); // ← voice.ts

      // 2) บันทึกเสียง + silence detection
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      setStatus("🎤 พูดได้เลย...");
      const uri = await recordWithSilenceDetection();

      // 3) ส่งไป AI server → STT → AI → ได้ข้อความกลับ
      setStatus("🤖 AI กำลังคิด...");
      speak("กรุณารอสักครู่นะคะ"); // ← voice.ts

      const isM4A = uri.endsWith(".m4a");
      const formData = new FormData();
      formData.append("file", {
        uri,
        name: isM4A ? "voice.m4a" : "voice.wav",
        type: isM4A ? "audio/m4a" : "audio/wav",
      } as any);

      const response = await fetch(SERVER_URL, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Server error ${response.status}: ${errText}`);
      }

      const contentType = response.headers.get("Content-Type") || "";

      if (contentType.includes("audio")) {
        // Server ส่ง MP3 กลับมา — ดึง X-AI-Response header แล้วพูดด้วย voice.ts
        const aiB64 = response.headers.get("X-AI-Response") || "";
        const userB64 = response.headers.get("X-User-Input") || "";
        const aiText = aiB64 ? atob(aiB64) : "";
        const userText = userB64 ? atob(userB64) : "";
        if (userText) console.log("[User]", userText);
        if (aiText) console.log("[AI]", aiText);

        setStatus("🔊 AI กำลังตอบ...");
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
        });

        // ✅ พูดด้วย voice.ts แทนการเล่น MP3
        await speak(aiText || "ขออภัย ไม่เข้าใจคำถาม");
      } else {
        // Fallback: server ส่ง JSON กลับ
        const json = await response.json().catch(() => ({}));
        const aiText = json?.aiResponse || "";
        console.log("[AI fallback]", aiText);
        if (aiText) {
          setStatus("🔊 AI กำลังตอบ...");
          await speak(aiText); // ← voice.ts
        }
      }

      setStatus(INTRO_MSG);
      speak(INTRO_MSG); // ← voice.ts
    } catch (error: any) {
      console.error("handlePress error:", error);
      setStatus("⚠️ เกิดข้อผิดพลาด แตะเพื่อลองใหม่");
      Alert.alert(
        "เกิดข้อผิดพลาด",
        `${error?.message || "ไม่ทราบสาเหตุ"}\n\nเช็ค:\n• Wi-Fi ตรงกับ IP เซิร์ฟเวอร์\n• AI server (port 3000) ทำงานอยู่ไหม\n• Python server (port 5000) ทำงานอยู่ไหม`,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        onPress={handlePress}
        style={[styles.button, loading && styles.buttonLoading]}
        activeOpacity={0.8}
        accessible
        accessibilityLabel={status}
        accessibilityHint="แตะเพื่อพูดคุยกับ AI"
      >
        <Text style={styles.buttonText}>{status}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  button: {
    flex: 1,
    backgroundColor: "#007AFF",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  buttonLoading: { backgroundColor: "#FF9500" },
  buttonText: {
    color: "white",
    fontSize: 40,
    fontWeight: "bold",
    textAlign: "center",
  },
});