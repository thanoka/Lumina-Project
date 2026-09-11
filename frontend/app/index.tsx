import mapData from "@/data/data-mock.json";
import axios from "axios";
import {
  FrameResponse,
  LocationNode,
  NavEvent,
  NavigationEngine,
  NavOutput,
  NavState,
} from "@/lib/navigation";
import { speak, speakWithEmotion, stopSpeech } from "@/lib/voice";
import { Audio } from "expo-av";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from "react-native";

const SERVER_URL = process.env.EXPO_PUBLIC_URL_7000 ?? '';
const AI_SERVER_URL = process.env.EXPO_PUBLIC_URL_3000 ?? '';


export default function Index() {
  const [permission, requestPermission] = useCameraPermissions();
  const [isRequesting, setIsRequesting] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [navState, setNavState] = useState<NavState>("idle");
  const [currentLocation, setCurrentLocation] = useState<string | null>(null);
  const [destinationName, setDestinationName] = useState<string | null>(null);
  const [stepInfo, setStepInfo] = useState<string>("");
  const [welcomeDone, setWelcomeDone] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [hospitalName, setHospitalName] = useState<string | null>(null);

  const cameraRef = useRef<CameraView>(null);
  const isProcessing = useRef(false);
  const holdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gracePeriodRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const secondsHeld = useRef(0);
  const [fps, setFps] = useState<number>(0);
  const [latency, setLatency] = useState<number>(0);
  const framesHandled = useRef<number>(0);
  const hasLocatedRef = useRef(false);
  const fpsTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── STT refs ───
  const sttHoldTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sttSecondsHeld = useRef(0);
  const sttActivated = useRef(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── AI Voice Logic ───
  const spokenNavSteps = useRef<Map<string, number>>(new Map()).current;
  const NAV_STEP_COOLDOWN = 15000;

  function shouldSpeak(event: NavEvent): boolean {
    if (event.tag !== 'navigation_step') return true;

    const key = `step:${event.data?.step_index ?? ''}:${event.data?.to_id ?? ''}`;
    const now = Date.now();
    const last = spokenNavSteps.get(key);

    if (last && (now - last) < NAV_STEP_COOLDOWN) {
      return false;
    }

    spokenNavSteps.set(key, now);
    return true;
  }

  const TAG_PRIORITY_MAP: Record<string, 'critical' | 'normal'> = {
    danger: 'critical',
    warning: 'critical',
  };

  const PRIORITY_SORT: Record<string, number> = {
    danger: 1, warning: 2, turn_now: 3, alignment_correction: 4,
    approaching_turn: 5, reroute: 6, location_update: 7,
    navigation_step: 8, route_started: 9, destination_set: 10,
    arrived: 11, no_route: 12, already_there: 13, navigation_cancelled: 14,
  };

  const triggerAIVoice = useCallback(async (output: NavOutput) => {
    if (!output.events || output.events.length === 0) return;

    // Don't send ANY events to AI until destination is set
    // During initial location scan, we only need to find position silently
    if (!output.destination && navState !== 'navigating' && navState !== 'arrived') {
      return;
    }

    const sorted = [...output.events].sort((a, b) =>
      (PRIORITY_SORT[a.tag] ?? 99) - (PRIORITY_SORT[b.tag] ?? 99)
    );

    const toSpeak = sorted.filter(e => shouldSpeak(e));
    if (toSpeak.length === 0) return;

    for (const event of toSpeak) {
      try {
        const filteredOutput = { ...output, events: [event] };
        const response = await axios.post(AI_SERVER_URL + '/navigate', filteredOutput);

        const { text, intensity, tag } = response.data;
        const priority = TAG_PRIORITY_MAP[tag] || 'normal';

        if (text) {
          await speakWithEmotion({ text, intensity: intensity ?? 0.3, priority });
        }
      } catch {
        console.warn("[AI] Backend unreachable for event:", event.tag);
      }
    }
  }, []);

  // ─── FPS Counter logic ───
  useEffect(() => {
    fpsTimer.current = setInterval(() => {
      setFps(framesHandled.current);
      framesHandled.current = 0;
    }, 1000);
    return () => {
      if (fpsTimer.current) clearInterval(fpsTimer.current);
    };
  }, []);

  // ─── Navigation Engine (initialized when hospital is selected) ───
  const navEngineRef = useRef<NavigationEngine | null>(null);

  // ─── Lock to landscape ───
  useEffect(() => {
    async function lockOrientation() {
      await ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.LANDSCAPE,
      );
    }
    lockOrientation();
  }, []);

  // ─── Welcome message (before permission) ───
  useEffect(() => {
    if (permission && !permission.granted && !isRequesting) {
      speak(
        "ยินดีต้อนรับสู่ ลุมินา กรุณาแตะหน้าจอค้างไว้ 5 วินาทีเพื่ออนุญาตการเข้าถึงกล้อง",
      );
    }
  }, [permission, isRequesting]);

  // ─── Welcome message (after permission granted) — ask for hospital ───
  useEffect(() => {
    if (permission?.granted && !welcomeDone) {
      setWelcomeDone(true);
      (async () => {
        Vibration.vibrate([0, 300, 100, 300]);
        await speak("ยินดีต้อนรับสู่ ลุมินา กรุณาบอกชื่อโรงพยาบาลที่คุณอยู่");
        await speak("กดหน้าจอค้างไว้ 3 วินาทีเพื่อพูด แล้วปล่อยเมื่อพูดเสร็จ");
        const { granted } = await Audio.requestPermissionsAsync();
        if (!granted) {
          await speak("กรุณาอนุญาตการใช้ไมค์เพื่อใช้งานการพูด");
        }
      })();
    }
  }, [permission?.granted, welcomeDone]);

  // ─── Hospital confirmed — announce and give instructions ───
  useEffect(() => {
    if (hospitalName) {
      (async () => {
        await stopSpeech();
        Vibration.vibrate([0, 300, 100, 300]);
        await speak(`ตั้งค่าโรงพยาบาล ${hospitalName} เรียบร้อย`);
        await speak("กรุณาหมุนตัวช้าๆ เพื่อให้ระบบหาตำแหน่งปัจจุบันก่อนบอกจุดหมายค่ะ");
        setIsStreaming(true);
        Vibration.vibrate([0, 500]);
      })();
    }
  }, [hospitalName]);

  // ─── STT: Hold 3s to start recording ───
  const handleMainPressIn = useCallback(() => {
    stopSpeech();
    setIsStreaming(false);
    
    // Block if welcome speech is still playing
    if (!permission?.granted || !welcomeDone) return;
    sttSecondsHeld.current = 0;
    sttActivated.current = false;

    const countdownStep = async (step: number) => {
      // If user already released, abort
      if (sttHoldTimerRef.current === null && step > 0) return;
      
      if (step === 1) setIsStreaming(false); // Pause scanning while listening

      sttSecondsHeld.current = step;
      const remaining = 3 - step;

      if (remaining > 0) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        await speak(remaining.toString());
        // Schedule next step (store timer so we can cancel on release)
        sttHoldTimerRef.current = setTimeout(() => countdownStep(step + 1), 300);
      } else if (!sttActivated.current) {
        sttActivated.current = true;
        sttHoldTimerRef.current = null;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        Vibration.vibrate(400);
        await startRecording();
      }
    };

    // Mark as active, start first step after 1s
    sttHoldTimerRef.current = setTimeout(() => countdownStep(1), 1000);
  }, [permission?.granted, welcomeDone]);

  const handleMainPressOut = useCallback(async () => {
    if (sttHoldTimerRef.current) {
      clearTimeout(sttHoldTimerRef.current as any);
      sttHoldTimerRef.current = null;
    }

    if (sttActivated.current && isRecording) {
      await stopRecordingAndTranscribe();
    } else {
      // If they released before activating, resume scanning if hospital is set
      // BUT don't resume if we have found location and are still waiting for destination
      if (hospitalName) {
        if (!hasLocatedRef.current || destinationName) {
          setIsStreaming(true);
        }
      }
    }
    sttSecondsHeld.current = 0;
    sttActivated.current = false;
  }, [isRecording, hospitalName, destinationName]);

  // ─── Tap: 3x cancel destination, 5x cancel hospital ───
  const handleMainTap = useCallback(() => {
    stopSpeech();
    setIsStreaming(false);
    
    if (!permission?.granted) return;
    tapCountRef.current += 1;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    tapTimerRef.current = setTimeout(() => {
      const count = tapCountRef.current;
      if (count >= 5) {
        // 5 taps — cancel hospital
        setHospitalName(null);
        navEngineRef.current = null;
        setNavState("idle");
        setDestinationName(null);
        setStepInfo("");
        setCurrentLocation(null);
        hasLocatedRef.current = false;
        speak("ยกเลิกโรงพยาบาลแล้ว กรุณาบอกชื่อโรงพยาบาลใหม่ กดค้างไว้ 3 วินาทีเพื่อพูด");
        Vibration.vibrate([0, 200, 100, 200, 100, 200, 100, 200, 100, 200]);
      } else if (count >= 3 && hospitalName) {
        // 3 taps — cancel destination
        if (navEngineRef.current && destinationName) {
          const event = navEngineRef.current.cancelNavigation();
          console.log("[NAV] cancel dest:", JSON.stringify(event));
          setNavState("idle");
          setDestinationName(null);
          setStepInfo("");
          speak("ยกเลิกจุดหมายแล้ว กดค้างเพื่อบอกจุดหมายใหม่");
          Vibration.vibrate([0, 200, 100, 200, 100, 200]);
        }
      }
      tapCountRef.current = 0;
    }, 800);
  }, [permission?.granted, hospitalName, destinationName]);

  // ─── Audio Recording helpers ───
  const startRecording = async () => {
    try {
      const audioPerm = await Audio.requestPermissionsAsync();
      if (!audioPerm.granted) {
        speak("ไม่สามารถบันทึกเสียงได้ กรุณาอนุญาตการใช้ไมค์ในตั้งค่าอุปกรณ์");
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const recording = new Audio.Recording();
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
      await recording.startAsync();
      recordingRef.current = recording;
      setIsRecording(true);
      console.log("[STT] 🎤 Recording started");
    } catch (err) {
      console.error("[STT] Failed to start recording:", err);
      speak("ไม่สามารถเริ่มบันทึกเสียงได้");
    }
  };

  const stopRecordingAndTranscribe = async () => {
    if (!recordingRef.current) return;
    try {
      console.log("[STT] Stopping recording...");
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      setIsRecording(false);

      if (!uri) {
        speak("ไม่สามารถบันทึกเสียงได้");
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      speak("กำลังประมวลผลเสียง");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // Send to STT server (pure transcription, no AI)
      const STT_URL = process.env.EXPO_PUBLIC_URL_5000;
      const isM4A = uri.endsWith(".m4a");
      const formData = new FormData();
      formData.append("file", {
        uri,
        name: isM4A ? "voice.m4a" : "voice.wav",
        type: isM4A ? "audio/m4a" : "audio/wav",
      } as any);

      const response = await fetch(`${STT_URL}/transcribe`, {
        method: "POST",
        body: formData,
        headers: { "Bypass-Tunnel-Reminder": "true" },
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("[STT] Server error:", errText);
        speak("เกิดข้อผิดพลาดในการประมวลผลเสียง");
        return;
      }

      const json = await response.json();
      const transcribedText = json?.text || "";

      if (transcribedText) {
        console.log("[STT] Transcribed:", transcribedText);
        if (!hospitalName) {
          // Hospital selection mode
          const matched = (mapData as any[]).find((h: any) =>
            h.HospitalName && transcribedText.toLowerCase().includes(h.HospitalName.toLowerCase())
          );
          if (matched) {
            navEngineRef.current = new NavigationEngine(matched.FloorPlan as LocationNode[]);
            setHospitalName(matched.HospitalName);
          } else {
            speak(`ไม่พบโรงพยาบาลที่ตรงกับ ${transcribedText} กรุณาลองใหม่`);
          }
        } else {
          // Destination selection mode
          // Enforce checking current location first!
          if (!currentLocation && navState !== "navigating" && navState !== "arrived") {
            speak("กรุณาหมุนตัวกล้องไปรอบๆ เพื่อให้ระบบยืนยันตำแหน่งปัจจุบันของคุณก่อนบอกจุดหมายค่ะ");
            return;
          }

          try {
            // Call the AI filter endpoint
            const contextStr = `ตำแหน่งปัจจุบัน: ${currentLocation || 'กำลังค้นหา'}
จุดหมายปลายทาง: ${destinationName || 'ยังไม่ได้ตั้ง'}
สถานะการนำทาง: ${navState === 'navigating' ? 'กำลังนำทาง' : 'ยังไม่เริ่มนำทาง'}
คำแนะนำปัจจุบัน: ${stepInfo || 'ไม่มี'}`;

            const dests = navEngineRef.current?.getAvailableDestinations() || [];
            console.log("[FILTER] Sending to AI filter:", transcribedText);
            console.log("[FILTER] Available destinations:", JSON.stringify(dests));

            const filterRes = await fetch(`${AI_SERVER_URL}/filter`, {
              method: "POST",
              headers: { 
                "Content-Type": "application/json",
                "Bypass-Tunnel-Reminder": "true" 
              },
              body: JSON.stringify({ 
                text: transcribedText,
                destinations: dests,
                contextInfo: contextStr
              })
            });

            if (filterRes.ok) {
              const filterResult = await filterRes.json();
              console.log("[FILTER] AI response:", JSON.stringify(filterResult));
              
              if (filterResult.type === "location") {
                const destId = filterResult.value;
                const dest = dests.find(d => d.id === destId);
                
                if (dest) {
                  // Set destination via the engine
                  const navEvents = navEngineRef.current?.setDestination(dest.id);
                  setDestinationName(dest.name);
                  setNavState(navEngineRef.current?.getState() || 'navigating');
                  console.log("[FILTER] ✅ Destination set:", dest.id, dest.name);
                  console.log("[FILTER] Nav events from setDestination:", JSON.stringify(navEvents));
                  
                  // Clear ALL speech, then speak destination + first instruction
                  stopSpeech();
                  speak(`ตั้งจุดหมายไปที่ ${dest.name} ค่ะ`);
                  
                  // Find the first navigation instruction from nav events
                  const routeEvent = navEvents?.find((e: any) => e.tag === 'route_started' || e.tag === 'navigation_step');
                  if (routeEvent?.data?.first_step?.instruction) {
                    speak(routeEvent.data.first_step.instruction);
                    setStepInfo(routeEvent.data.first_step.instruction);
                  } else if (routeEvent?.data?.instruction) {
                    speak(routeEvent.data.instruction);
                    setStepInfo(routeEvent.data.instruction);
                  }
                  setIsStreaming(true);
                } else {
                  // LLM returned an ID we can't find — try fuzzy match by name
                  const fuzzyDest = dests.find(d => 
                    d.name.toLowerCase().includes(destId.toLowerCase()) ||
                    destId.toLowerCase().includes(d.name.toLowerCase())
                  );
                  if (fuzzyDest) {
                    const navEvents = navEngineRef.current?.setDestination(fuzzyDest.id);
                    setDestinationName(fuzzyDest.name);
                    setNavState(navEngineRef.current?.getState() || 'navigating');
                    console.log("[FILTER] ✅ Fuzzy match destination:", fuzzyDest.id, fuzzyDest.name);
                    
                    stopSpeech();
                    speak(`ตั้งจุดหมายไปที่ ${fuzzyDest.name} ค่ะ`);
                    
                    const routeEvent = navEvents?.find((e: any) => e.tag === 'route_started' || e.tag === 'navigation_step');
                    if (routeEvent?.data?.first_step?.instruction) {
                      speak(routeEvent.data.first_step.instruction);
                      setStepInfo(routeEvent.data.first_step.instruction);
                    } else if (routeEvent?.data?.instruction) {
                      speak(routeEvent.data.instruction);
                      setStepInfo(routeEvent.data.instruction);
                    }
                    setIsStreaming(true);
                  } else {
                    console.log("[FILTER] ❌ No destination match for:", destId);
                    speak("ขออภัยค่ะ ไม่พบจุดหมายที่คุณต้องการในระบบ กรุณากดค้างไว้ 3 วินาทีเพื่อบอกใหม่");
                  }
                }
              } else if (filterResult.type === "curious") {
                console.log("[FILTER] 🔍 Curious — speaking:", filterResult.value);
                speak(filterResult.value);
                if (destinationName) setIsStreaming(true);
              } else if (filterResult.type === "inappropriate") {
                console.log("[FILTER] ⚠️ Inappropriate/Off-topic — speaking:", filterResult.value);
                Vibration.vibrate([0, 100, 50, 100]);
                speak(filterResult.value);
              } else {
                // General — speak the LLM-generated reply
                console.log("[FILTER] 💬 General — speaking:", filterResult.value);
                speak(filterResult.value);
                if (destinationName) setIsStreaming(true); 
              }
            } else {
              console.error("[FILTER] Server returned:", filterRes.status);
              speak("ขออภัยค่ะ ระบบประมวลผลขัดข้อง");
              if (destinationName) setIsStreaming(true);
            }
          } catch (e) {
            console.error("[FILTER] Fetch error:", e);
            speak("ขออภัยค่ะ เกิดข้อผิดพลาดในการเชื่อมต่อ");
            if (destinationName) setIsStreaming(true);
          }
        }
      } else {
        console.log("[STT] No text received");
        speak("ไม่สามารถแปลงเสียงเป็นข้อความได้");
        if (destinationName) setIsStreaming(true);
      }
    } catch (err) {
      console.error("[STT] Error:", err);
      speak("เกิดข้อผิดพลาด");
      setIsRecording(false);
      if (destinationName) setIsStreaming(true);
    }
  };

  // ─── Process a single frame and run navigation logic ───
  const processOneFrame = useCallback(async () => {
    if (!cameraRef.current || isProcessing.current || !navEngineRef.current) return;
    isProcessing.current = true;
    const startTime = Date.now();

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.1,
        base64: false,
        skipProcessing: true,
      });

      if (!photo) return;

      const formData = new FormData();
      formData.append("file", {
        uri: photo.uri,
        name: "frame.jpg",
        type: "image/jpeg",
      } as any);

      const response = await fetch(`${SERVER_URL}/process-frame`, {
        method: "POST",
        body: formData,
        headers: {
          "Bypass-Tunnel-Reminder": "true",
          Accept: "application/json",
        },
      });

      if (!response.ok) return;

      const frameData: FrameResponse = await response.json();

      // ── Run the navigation engine ──
      const navOutput: NavOutput = navEngineRef.current!.processFrame(frameData);
      triggerAIVoice(navOutput);

      // Log JSON to console (this is what the LLM will consume)
      if (navOutput.events.length > 0) {
        console.log("[NAV]", JSON.stringify(navOutput, null, 2));
      }

      // Update UI state
      setNavState(navOutput.state);

      if (navOutput.current_location) {
        setCurrentLocation(navOutput.current_location.name);
        
        if (!hasLocatedRef.current) {
          hasLocatedRef.current = true;
          setIsStreaming(false);
          stopSpeech();
          speak(`พบตำแหน่งปัจจุบันคือ ${navOutput.current_location.name} ค่ะ`);
          speak("กรุณากดค้างไว้ 3 วินาทีเพื่อบอกจุดหมายปลายทาง");
          speak("กดหน้าจอ 3 ครั้งเพื่อยกเลิกจุดหมาย");
          speak("กดหน้าจอ 5 ครั้งเพื่อเปลี่ยนโรงพยาบาล");
        }
      }

      if (navOutput.route?.current_step) {
        setStepInfo(navOutput.route.current_step.instruction);
      }

      // Check events for arrival / haptics
      for (const event of navOutput.events) {
        if (event.tag === "arrived") {
          setDestinationName(null);
          setStepInfo("");
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        }
        if (event.tag === "danger") {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        }
        if (event.tag === "warning") {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
        if (event.tag === "navigation_step" || event.tag === "reroute") {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
      }

      // Performance stats
      setLatency(Date.now() - startTime);
      framesHandled.current++;
    } catch (err: any) {
      console.error("Stream Error Details:", err);
      if (err.message === "Network request failed") {
        console.warn(
          "Hint: Check your internet connection"
        );
      }
    } finally {
      isProcessing.current = false;
    }
  }, [navState, currentLocation, triggerAIVoice]);

  // ─── Streaming loop ───
  useEffect(() => {
    let isMounted = true;

    async function streamLoop() {
      if (
        !permission?.granted ||
        !cameraRef.current ||
        !isMounted ||
        !isStreaming
      )
        return;
      await processOneFrame();
      if (isMounted && isStreaming) {
        setTimeout(streamLoop, 50); // Reduced from 400ms for better responsiveness
      }
    }

    if (permission?.granted && isStreaming) {
      streamLoop();
    }

    return () => {
      isMounted = false;
    };
  }, [permission?.granted, isStreaming, processOneFrame]);



  // ─── Camera permission hold-to-request ───
  const handlePressIn = () => {
    secondsHeld.current = 0;
    if (gracePeriodRef.current) clearTimeout(gracePeriodRef.current);
    speak("เริ่มนับถอยหลัง");
    holdTimerRef.current = setInterval(async () => {
      secondsHeld.current += 1;
      const remaining = 5 - secondsHeld.current;
      if (remaining > 0) {
        speak(remaining.toString());
        if (remaining >= 3) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } else {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
      } else {
        if (holdTimerRef.current) clearInterval(holdTimerRef.current);
        holdTimerRef.current = null;
        setIsRequesting(true);
        speak("กรุณากดอนุญาตในหน้าต่างที่ปรากฏขึ้น");
        await requestPermission();
        await Audio.requestPermissionsAsync();
        gracePeriodRef.current = setTimeout(() => {
          setIsRequesting(false);
        }, 10000);
      }
    }, 1000);
  };

  const handlePressOut = () => {
    if (secondsHeld.current < 5) {
      if (holdTimerRef.current) {
        clearInterval(holdTimerRef.current);
        holdTimerRef.current = null;
        speak("ยกเลิกการขออนุญาต");
      }
    }
    secondsHeld.current = 0;
  };

  // ─── State color mapping ───
  const getStateColor = (): string => {
    switch (navState) {
      case "navigating":
        return "#1E88E5";
      case "arrived":
        return "#43A047";
      case "locating":
        return "#FB8C00";
      case "lost":
        return "#E53935";
      case "rerouting":
        return "#8E24AA";
      default:
        return "#28a745";
    }
  };

  const getStateLabel = (): string => {
    switch (navState) {
      case "idle":
        return "พร้อมใช้งาน";
      case "locating":
        return "กำลังหาตำแหน่ง...";
      case "navigating":
        return "กำลังนำทาง";
      case "arrived":
        return "ถึงจุดหมายแล้ว!";
      case "lost":
        return "หาตำแหน่งไม่ได้";
      case "rerouting":
        return "ปรับเส้นทางใหม่...";
      default:
        return "";
    }
  };

  // ─── Render: Permission request ───
  if (!permission) return <View style={styles.container} />;

  if (!permission?.granted) {
    return (
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={styles.fullScreenButton}
      >
        <Text style={styles.text}>
          {isRequesting
            ? "กำลังรอการกดอนุญาต..."
            : "แตะหน้าจอค้างไว้ 5 วินาทีเพื่อเปิดกล้อง"}
        </Text>
      </Pressable>
    );
  }

  // ─── Render: Main navigation view ───
  return (
    <Pressable
      style={styles.container}
      onPress={handleMainTap}
      onPressIn={handleMainPressIn}
      onPressOut={handleMainPressOut}
    >
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        animateShutter={false}
        mute={true}
      />

      {/* Performance Overlay */}
      <View style={styles.perfOverlay}>
        <Text style={styles.perfText}>FPS: {fps}</Text>
        <Text
          style={[
            styles.perfText,
            { color: latency > 1000 ? "#FF5252" : "#4CAF50" },
          ]}
        >
          Lat: {latency}ms
        </Text>
      </View>

      {/* ── Status Bar (top) ── */}
      <View style={styles.topBar}>
        <View
          style={[styles.statusBadge, { backgroundColor: getStateColor() }]}
        >
          <Text style={styles.statusText}>{getStateLabel()}</Text>
        </View>
        {currentLocation && (
          <View style={styles.locationBadge}>
            <Text style={styles.locationIcon}>📍</Text>
            <Text style={styles.locationText}>{currentLocation}</Text>
          </View>
        )}
        {destinationName && navState !== "arrived" ? (
          <View style={styles.destBadge}>
            <Text style={styles.destBadgeText}>🎯 {destinationName}</Text>
          </View>
        ) : null}
      </View>

      {/* ── Navigation Instruction (compact, below top bar) ── */}
      {navState === "navigating" && stepInfo ? (
        <View style={styles.navInfoCompact}>
          <Text style={styles.navInfoCompactText} numberOfLines={2}>{stepInfo}</Text>
        </View>
      ) : null}

      {/* ── Bottom Controls ── */}
      <View style={styles.overlay}>
        {/* Stop Button */}
        {isStreaming ? (
          <TouchableOpacity
            style={[styles.btn, styles.btnStop]}
            onPress={() => {
              stopSpeech();
              setIsStreaming(false);
            }}
            accessible
            accessibilityLabel="หยุดการทำงาน"
          >
            <Text style={styles.btnText}>🛑</Text>
            <Text style={styles.btnSubText}>STOP</Text>
          </TouchableOpacity>
        ) : null}

        {/* Simulator — for testing without the hospital */}
        <SimulatorButton />
      </View>

      {/* ── Recording indicator ── */}
      {isRecording && (
        <View style={styles.recordingOverlay}>
          <Text style={styles.recordingText}>🎤 กำลังฟัง... ปล่อยเมื่อพูดเสร็จ</Text>
        </View>
      )}
    </Pressable>
  );
}

// ─── Simulator Button (for testing without the hospital) ───
function SimulatorButton() {
  const router = useRouter();
  return (
    <TouchableOpacity
      style={{
        backgroundColor: "#FF980088",
        paddingVertical: 14,
        paddingHorizontal: 20,
        borderRadius: 30,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: "#FF9800",
      }}
      onPress={async () => {
        await stopSpeech();
        router.push("/simulator");
      }}
      accessible
      accessibilityLabel="Open simulator"
    >
      <Text style={{ color: "white", fontSize: 16, fontWeight: "bold" }}>
        🧪
      </Text>
      <Text
        style={{
          color: "rgba(255,255,255,0.8)",
          fontSize: 9,
          fontWeight: "600",
          marginTop: 2,
        }}
      >
        SIM
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  camera: { flex: 1 },

  // ── Top bar ──
  topBar: {
    position: "absolute",
    top: 12,
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  statusBadge: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  locationBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
  },
  locationIcon: {
    fontSize: 14,
  },
  locationText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },

  // ── Navigation info (compact below top bar) ──
  navInfoCompact: {
    position: "absolute",
    top: 46,
    left: 8,
    right: 8,
    backgroundColor: "rgba(30, 136, 229, 0.75)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  navInfoCompactText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
    textAlign: "center",
  },

  // ── Destination badge (inline in top bar) ──
  destBadge: {
    backgroundColor: "rgba(255, 213, 79, 0.25)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 213, 79, 0.5)",
  },
  destBadgeText: {
    color: "#FFD54F",
    fontSize: 11,
    fontWeight: "600",
  },

  // ── Performance Overlay ──
  perfOverlay: {
    position: "absolute",
    top: 50,
    right: 20,
    backgroundColor: "rgba(0,0,0,0.6)",
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    zIndex: 100,
  },
  perfText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "bold",
    fontFamily: "monospace",
    textAlign: "right",
  },

  // ── Bottom controls ──
  overlay: {
    position: "absolute",
    bottom: 24,
    width: "100%",
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 20,
    paddingHorizontal: 24,
  },
  btn: {
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 100,
  },
  btnStart: { backgroundColor: "#43A047" },
  btnStop: { backgroundColor: "#E53935" },
  btnNav: { backgroundColor: "#1E88E5" },

  // ── Recording overlay ──
  recordingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(229, 57, 53, 0.45)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 200,
  },
  recordingText: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "bold",
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.7)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 4,
  },

  btnText: {
    color: "white",
    fontSize: 18,
    fontWeight: "bold",
  },
  btnSubText: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 10,
    fontWeight: "600",
    marginTop: 2,
  },

  // ── Permission screen ──
  fullScreenButton: {
    flex: 1,
    backgroundColor: "#000",
    justifyContent: "center",
    alignItems: "center",
  },
  text: {
    fontSize: 28,
    fontWeight: "bold",
    color: "white",
    textAlign: "center",
    padding: 20,
  },
});
