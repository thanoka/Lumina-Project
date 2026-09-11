import axios from 'axios';
import { speakWithEmotion } from '@/lib/voice';
import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import {
  NavigationEngine,
  NavOutput,
  NavState,
  NavEvent,
  LocationNode,
  FrameResponse,
  simulateFrame,
  simulateTransitionFrame,
  getNodeById,
} from '@/lib/navigation';
import mapData from '@/data/data-mock.json';

// ─── Constants ──────────────────────────────────────────────────────────────

const NODE_COLORS: Record<string, string> = {
  GF_Main_Entrance: '#4CAF50',
  GF_Central_Hall:  '#2196F3',
  GF_Registration:  '#FF9800',
  GF_Screening:     '#9C27B0',
  GF_Restrooms:     '#00BCD4',
};

const EVENT_COLORS: Record<string, string> = {
  danger:               '#FF5252',
  warning:              '#FFA726',
  turn_now:             '#FF1744',
  approaching_turn:     '#FFD600',
  alignment_correction: '#40C4FF',
  navigation_step:      '#69F0AE',
  waypoint_reached:     '#B2FF59',
  arrived:              '#00E676',
  reroute:              '#EA80FC',
  location_update:      '#82B1FF',
  guidance_needed:      '#FF80AB',
  default:              '#8CC265',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function eventColor(tag: string): string {
  return EVENT_COLORS[tag] ?? EVENT_COLORS.default;
}

function eventIcon(tag: string): string {
  const icons: Record<string, string> = {
    danger:               '🔴',
    warning:              '🟡',
    turn_now:             '🔄',
    approaching_turn:     '⚠️',
    alignment_correction: '↔️',
    navigation_step:      '🧭',
    waypoint_reached:     '📍',
    arrived:              '✅',
    reroute:              '🔁',
    location_update:      '📡',
    guidance_needed:      '🔍',
    sign_read:            '🪧',
    destination_set:      '🎯',
    route_started:        '🚀',
    already_there:        '🏁',
    no_route:             '❌',
    navigation_cancelled: '✕',
  };
  return icons[tag] ?? '•';
}

const SERVER_URL = process.env.EXPO_PUBLIC_URL_3000 || '';

// ─── Component ──────────────────────────────────────────────────────────────

export default function SimulatorScreen() {
  const nodes = mapData[0].FloorPlan as LocationNode[];
  const navEngine = useRef<NavigationEngine>(new NavigationEngine(nodes)).current;

  const [navState, setNavState]               = useState<NavState>('idle');
  const [simulatedLocation, setSimulated]     = useState<string | null>(null);
  const [destinationId, setDestinationId]     = useState<string | null>(null);
  const [currentRoute, setCurrentRoute]       = useState<NavOutput['route']>(null);
  const [eventLog, setEventLog]               = useState<NavEvent[]>([]);
  const [includeObstacles, setObstacles]      = useState(false);
  const [closenessSize, setClosenessSize]     = useState(0.05); // 0–0.40 in steps of 0.05

  // ── Lock to portrait while on this screen, restore landscape on leave ────
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    return () => {
      // Re-lock to LANDSCAPE (main app default) instead of unlockAsync,
      // which would leave the device in an undefined orientation state.
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    };
  }, []);

  // ── Log helpers ───────────────────────────────────────────────────────────

  const pushEvents = (events: NavEvent[]) => {
    if (events.length === 0) return;
    console.log('\n[SIM EVENTS]', JSON.stringify(events, null, 2));
    setEventLog(prev => [...events, ...prev].slice(0, 60));
  };

const processOutput = (output: NavOutput) => {
    // Standard UI Updates
    setNavState(output.state);
    if (output.route) setCurrentRoute(output.route);
    if (output.state === 'arrived') {
      setDestinationId(null);
      setCurrentRoute(null);
    }
    pushEvents(output.events);

    // ─── NEW: SEND TO EVENT TOME ───
    // This ensures EVERY event (walk, turn, drift) goes to the AI
    triggerAIVoice(output); 
  };

  // ── Walk to a location ────────────────────────────────────────────────────

  const simulateWalkTo = useCallback((nodeId: string) => {
    const node = getNodeById(nodes, nodeId);
    if (!node) return;
    setSimulated(nodeId);

    // 1 transition + 3 stable frames (matches stability check: 2 consecutive)
    const frames: FrameResponse[] = [
      simulateTransitionFrame(),
      simulateFrame(node, includeObstacles),
      simulateFrame(node, includeObstacles),
      simulateFrame(node, includeObstacles),
    ];

    for (const frame of frames) {
      const output = navEngine.processFrame(frame);
      processOutput(output);
    }
  }, [navEngine, nodes, includeObstacles, processOutput]);

  // ── Set destination ───────────────────────────────────────────────────────

  const handleSetDestination = useCallback((destId: string) => {
    setDestinationId(destId);

    // If no location is known yet, seed Main Entrance so route can be calculated immediately
    if (!navEngine.getCurrentLocation()) {
      const mainNode = getNodeById(nodes, 'GF_Main_Entrance')!;
      const seedFrames = [
        simulateFrame(mainNode, false),
        simulateFrame(mainNode, false),
        simulateFrame(mainNode, false),
      ];
      for (const f of seedFrames) {
        const out = navEngine.processFrame(f);
        if (out.current_location) {
          setSimulated('GF_Main_Entrance');
          setNavState(out.state);
          break;
        }
      }
    }

    const events = navEngine.setDestination(destId);
    setNavState(navEngine.getState());

    const route = navEngine.getRoute();
    if (route && route.steps.length > 0) {
      const s0 = route.steps[0];
      setCurrentRoute({
        step_index:  0,
        total_steps: route.totalSteps,
        current_step: {
          direction:   s0.direction,
          distance:    s0.distance,
          path_type:   s0.pathType,
          from:        s0.from,
          to:          s0.to,
          instruction: s0.instruction,
          turn_ref:    s0.turn_ref,
        },
      });
    }

    pushEvents(events);

    // ── Speak destination + route via AI ──
    // Build a synthetic NavOutput so triggerAIVoice can process it
    if (events.length > 0) {
      const destNode = getNodeById(nodes, destId);
      const syntheticOutput: NavOutput = {
        state: navEngine.getState(),
        current_location: navEngine.getCurrentLocation()
          ? { id: navEngine.getCurrentLocation()!, name: getNodeById(nodes, navEngine.getCurrentLocation()!)?.name || '', confidence: 100 }
          : null,
        destination: destNode ? { id: destId, name: destNode.name } : null,
        route: route ? {
          step_index: 0,
          total_steps: route.totalSteps,
          current_step: route.steps[0] ? {
            direction: route.steps[0].direction,
            distance: route.steps[0].distance,
            path_type: route.steps[0].pathType,
            from: route.steps[0].from,
            to: route.steps[0].to,
            instruction: route.steps[0].instruction,
            turn_ref: route.steps[0].turn_ref,
          } : null,
        } : null,
        safety: [],
        events,
      };
      triggerAIVoice(syntheticOutput);
    }
  }, [navEngine, nodes]);

  // ── Simulate turn approach / execute ─────────────────────────────────────





  const spokenNavSteps = useRef<Map<string, number>>(new Map()).current;
  const NAV_STEP_COOLDOWN = 15000; // 15s before same step can repeat

  function shouldSpeak(event: NavEvent): boolean {
    if (event.tag !== 'navigation_step') return true;

    const key = `step:${event.data?.step_index ?? ''}:${event.data?.to_id ?? ''}`;
    const now = Date.now();
    const last = spokenNavSteps.get(key);

    if (last && (now - last) < NAV_STEP_COOLDOWN) {
      console.log(`🔇 [DEDUP] Skipping repeated navigation_step (same step spoken ${Math.round((now - last) / 1000)}s ago)`);
      return false;
    }

    spokenNavSteps.set(key, now);
    return true;
  }

  const TAG_PRIORITY_MAP: Record<string, 'critical' | 'normal'> = {
    danger:  'critical',
    warning: 'critical',
  };

  const PRIORITY_SORT: Record<string, number> = {
    danger: 1, warning: 2, turn_now: 3, alignment_correction: 4,
    approaching_turn: 5, reroute: 6, location_update: 7,
    navigation_step: 8, route_started: 9, destination_set: 10,
    arrived: 11, no_route: 12, already_there: 13, navigation_cancelled: 14,
  };

const triggerAIVoice = async (output: NavOutput) => {
    if (!output.events || output.events.length === 0) return;

    const sorted = [...output.events].sort((a, b) =>
      (PRIORITY_SORT[a.tag] ?? 99) - (PRIORITY_SORT[b.tag] ?? 99)
    );

    const toSpeak = sorted.filter(e => shouldSpeak(e));
    if (toSpeak.length === 0) return;

    for (const event of toSpeak) {
      try {
        const filteredOutput = { ...output, events: [event] };
        const response = await axios.post( SERVER_URL + '/navigate', filteredOutput);

        const { text, intensity, suggestion, tag } = response.data;
        const priority = TAG_PRIORITY_MAP[tag] || 'normal';

        console.log("-----------------------------------------");
        console.log(`🤖 [${tag}] ${text}`);
        console.log(`   🎚️ intensity: ${intensity} | priority: ${priority}`);
        if (suggestion) console.log(`   💡 ${suggestion}`);
        console.log("-----------------------------------------");

        if (text) {
          await speakWithEmotion({ text, intensity: intensity ?? 0.3, priority });
        }
      } catch {
        console.warn("[AI] Backend unreachable for event:", event.tag);
      }
    }
  };

  const simulateTurnBySize = useCallback((size: number) => {
    const route = navEngine.getRoute();
    if (!route) return;
    const step = route.steps[0];
    if (!step?.turn_ref) return;
    const ref = step.turn_ref;

    const fakeFrame: FrameResponse = {
      status: 'success',
      detections: [{
        label:         ref.object_name,
        grid_location: 'center',
        size_pct:      size,
        type:          'safety',
        text_content:  ref.text_content,
      }],
      can_read_sign: !!ref.text_content,
      sign_text:     ref.text_content ?? '',
    };

    const output = navEngine.processFrame(fakeFrame);
    processOutput(output);
  }, [navEngine, processOutput]);

  // ── Simulate alignment drift ──────────────────────────────────────────────

  const simulateAlignmentDrift = useCallback((side: 'left' | 'right') => {
    const loc = navEngine.getCurrentLocation();
    if (!loc) return;
    const node = getNodeById(nodes, loc);
    if (!node) return;

    const primaryRef = node['reference-point'][0];
    // Drift LEFT → camera tilts left → sign appears on LEFT side of frame
    // Drift RIGHT → camera tilts right → sign appears on RIGHT side of frame
    const fakeFrame: FrameResponse = {
      status: 'success',
      detections: [{
        label:         primaryRef.object_name,
        grid_location: side === 'left' ? 'left' : 'right',
        size_pct:      0.08,
        type:          'safety',
        text_content:  primaryRef.text_content,
      }],
      can_read_sign: false,
      sign_text:     '',
    };

    const output = navEngine.processFrame(fakeFrame);
    processOutput(output);
  }, [navEngine, nodes, processOutput]);

  // ── Simulate alignment re-center (sign back to expected position) ────────

  const simulateAlignmentRecenter = useCallback(() => {
    const loc = navEngine.getCurrentLocation();
    if (!loc) return;
    const node = getNodeById(nodes, loc);
    if (!node) return;

    const primaryRef = node['reference-point'][0];
    // Send sign at its expected position → expected == detected → NO alignment_correction event
    const fakeFrame: FrameResponse = {
      status: 'success',
      detections: [{
        label:         primaryRef.object_name,
        grid_location: primaryRef.location_in_frame,   // exact expected grid
        size_pct:      0.08,
        type:          'safety',
        text_content:  primaryRef.text_content,
      }],
      can_read_sign: false,
      sign_text:     '',
    };

    const output = navEngine.processFrame(fakeFrame);
    processOutput(output);
  }, [navEngine, nodes, processOutput]);



  // ── Cancel ────────────────────────────────────────────────────────────────

  const handleCancel = useCallback(() => {
    const event = navEngine.cancelNavigation();
    setNavState('idle');
    setDestinationId(null);
    setCurrentRoute(null);
    pushEvents([event]);
  }, [navEngine]);

  // ── UI helpers ────────────────────────────────────────────────────────────

  const STATE_COLOR: Record<string, string> = {
    navigating: '#1E88E5',
    arrived:    '#43A047',
    locating:   '#FB8C00',
    lost:       '#E53935',
    rerouting:  '#8E24AA',
    idle:       '#616161',
  };

  const currentStep = currentRoute?.current_step;
  const hasTurnRef  = !!currentStep?.turn_ref;

  // Look up turn_ref directly from map (no engine state needed — always available when dest is set)
  const activeTurnRef = (() => {
    if (!simulatedLocation || !destinationId) return null;
    const fromNode = getNodeById(nodes, simulatedLocation);
    if (!fromNode) return null;
    // Direct edge first
    const direct = fromNode.neighbors.find(n => n.target_id === destinationId);
    if (direct?.turn_ref) return direct.turn_ref;
    // Otherwise check first step of current route
    return currentStep?.turn_ref ?? null;
  })();

  // ──────────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={s.root}>
      <ScrollView contentContainerStyle={s.scroll}>

        {/* ─ Header ─ */}
        <Text style={s.title}>🧪 Navigation Simulator</Text>
        <Text style={s.subtitle}>Vertical · console → full JSON</Text>

        {/* ─ Status Card ─ */}
        <View style={s.card}>
          <View style={s.row}>
            <View style={[s.badge, { backgroundColor: STATE_COLOR[navState] ?? '#616161' }]}>
              <Text style={s.badgeText}>{navState.toUpperCase()}</Text>
            </View>
            {navState !== 'idle' && (
              <TouchableOpacity style={s.cancelBtn} onPress={handleCancel}>
                <Text style={s.cancelBtnText}>✕ Cancel</Text>
              </TouchableOpacity>
            )}
          </View>

          {simulatedLocation && (
            <InfoRow label="📍 At" value={getNodeById(nodes, simulatedLocation)?.name ?? simulatedLocation} />
          )}
          {destinationId && (
            <InfoRow label="🏁 Going to" value={getNodeById(nodes, destinationId)?.name ?? destinationId} highlight />
          )}
          {currentRoute && (
            <InfoRow
              label={`🧭 Step ${currentRoute.step_index + 1}/${currentRoute.total_steps}`}
              value={currentStep?.instruction ?? '—'}
            />
          )}
        </View>

        {/* ─ Turn Ref Card (shows while navigating a turn step) ─ */}
        {hasTurnRef && currentStep?.turn_ref && (
          <View style={s.turnCard}>
            <Text style={s.turnTitle}>🔄 Active Turn Trigger</Text>
            <InfoRow label="Object"    value={currentStep.turn_ref.object_name} />
            {currentStep.turn_ref.text_content && (
              <InfoRow label="Sign text" value={`"${currentStep.turn_ref.text_content}"`} />
            )}
            <InfoRow label="Warn at"   value={`${Math.round(currentStep.turn_ref.warn_at * 100)}% of frame`} />
            <InfoRow label="Turn at"   value={`${Math.round(currentStep.turn_ref.turn_at * 100)}% of frame`} />
            <InfoRow label="Direction" value={`Turn ${currentStep.direction}`} highlight />
          </View>
        )}

        {/* ─ Closeness Tester (always available when dest with turn_ref is selected) ─ */}
        {activeTurnRef ? (
          <View style={s.closenessCard}>
            <Text style={s.turnTitle}>📏 Closeness Tester</Text>
            <Text style={s.closenessHint}>
              Simulate how big the landmark &quot;{activeTurnRef.text_content ?? activeTurnRef.object_name}&quot; appears in frame.
              Press Fire to send the frame and see what event fires.
            </Text>

            {/* Bar */}
            <View style={s.stepperRow}>
              <TouchableOpacity
                style={s.stepperBtn}
                onPress={() => setClosenessSize(v => Math.max(0, parseFloat((v - 0.05).toFixed(2))))}
              >
                <Text style={s.stepperBtnTxt}>−</Text>
              </TouchableOpacity>

              <View style={s.stepperBar}>
                <View style={[
                  s.stepperFill,
                  {
                    width: `${Math.min(closenessSize / 0.40 * 100, 100)}%` as any,
                    backgroundColor:
                      closenessSize >= activeTurnRef.turn_at ? '#FF1744' :
                      closenessSize >= activeTurnRef.warn_at ? '#FFD600' : '#4CAF50',
                  },
                ]} />
                {/* Yellow marker = warn threshold */}
                <View style={[s.stepperMark, { left: `${(activeTurnRef.warn_at / 0.40) * 100}%` as any }]} />
                {/* Red marker = turn threshold */}
                <View style={[s.stepperMark, { left: `${(activeTurnRef.turn_at / 0.40) * 100}%` as any, backgroundColor: '#FF1744' }]} />
              </View>

              <TouchableOpacity
                style={s.stepperBtn}
                onPress={() => setClosenessSize(v => Math.min(0.40, parseFloat((v + 0.05).toFixed(2))))}
              >
                <Text style={s.stepperBtnTxt}>+</Text>
              </TouchableOpacity>
            </View>

            {/* Value + status label */}
            <Text style={s.stepperValue}>
              {Math.round(closenessSize * 100)}% of frame
              {'  '}{
                closenessSize >= activeTurnRef.turn_at ? '🔴 TURN NOW' :
                closenessSize >= activeTurnRef.warn_at ? '⚠️ APPROACHING' : '🟢 far — no event'
              }
            </Text>
            <Text style={s.closenessThresholds}>
              ⚠️ warn_at = {Math.round(activeTurnRef.warn_at * 100)}%{'   '}🔴 turn_at = {Math.round(activeTurnRef.turn_at * 100)}%
            </Text>

            <TouchableOpacity
              style={[s.fireBtn, {
                backgroundColor:
                  closenessSize >= activeTurnRef.turn_at ? '#330010' :
                  closenessSize >= activeTurnRef.warn_at ? '#332800' : '#0a1a0a',
                borderColor:
                  closenessSize >= activeTurnRef.turn_at ? '#FF1744' :
                  closenessSize >= activeTurnRef.warn_at ? '#FFD600' : '#4CAF50',
              }]}
              onPress={() => simulateTurnBySize(closenessSize)}
            >
              <Text style={[s.fireBtnTxt, {
                color:
                  closenessSize >= activeTurnRef.turn_at ? '#FF1744' :
                  closenessSize >= activeTurnRef.warn_at ? '#FFD600' : '#4CAF50',
              }]}>
                🔥 Fire at {Math.round(closenessSize * 100)}%
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.closenessCardDisabled}>
            <Text style={s.closenessHint}>📏 Closeness Tester — set a destination with a turn to enable</Text>
          </View>
        )}

        {/* ─ Walk To ─ */}
        <Text style={s.section}>🚶 Walk To Location</Text>
        <View style={s.grid}>
          {nodes.map(node => (
            <TouchableOpacity
              key={node.id}
              style={[
                s.nodeBtn,
                { borderColor: NODE_COLORS[node.id] ?? '#666' },
                simulatedLocation === node.id && { backgroundColor: NODE_COLORS[node.id] ?? '#666' },
              ]}
              onPress={() => simulateWalkTo(node.id)}
            >
              <Text style={[s.nodeBtnTxt, simulatedLocation === node.id && { color: '#fff' }]}>
                {node.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ─ Set Destination ─ */}
        <Text style={s.section}>🎯 Set Destination</Text>
        <View style={s.grid}>
          {nodes.map(node => (
            <TouchableOpacity
              key={`d-${node.id}`}
              style={[s.destBtn, destinationId === node.id && s.destBtnActive]}
              onPress={() => handleSetDestination(node.id)}
            >
              <Text style={[s.destBtnTxt, destinationId === node.id && { color: '#000' }]}>
                {node.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ─ Alignment Drift Test ─ */}
        <Text style={s.section}>↔️ Test Alignment Correction</Text>
        <Text style={s.hint}>Drift left → sign to LEFT → turn_right    |    Re-center → no event    |    Drift right → sign to RIGHT → turn_left</Text>
        <View style={s.row2}>
          <TouchableOpacity style={s.driftBtn} onPress={() => simulateAlignmentDrift('left')}>
            <Text style={s.driftBtnTxt}>← Drift Left</Text>
            <Text style={s.driftBtnSub}>sign → left col</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.recenterBtn} onPress={simulateAlignmentRecenter}>
            <Text style={s.recenterBtnTxt}>✓ Re-center</Text>
            <Text style={s.driftBtnSub}>no event</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.driftBtn} onPress={() => simulateAlignmentDrift('right')}>
            <Text style={s.driftBtnTxt}>Drift Right →</Text>
            <Text style={s.driftBtnSub}>sign → right col</Text>
          </TouchableOpacity>
        </View>

        {/* ─ Obstacles Toggle ─ */}
        <TouchableOpacity
          style={[s.toggleBtn, includeObstacles && s.toggleBtnOn]}
          onPress={() => setObstacles(v => !v)}
        >
          <Text style={s.toggleBtnTxt}>
            {includeObstacles ? '⚠️ Obstacles: ON' : '🟢 Obstacles: OFF'}
          </Text>
        </TouchableOpacity>

        {/* ─ Event Log ─ */}
        <Text style={s.section}>📋 Event Log</Text>
        <Text style={s.hint}>Full JSON → terminal console</Text>
        <View style={s.logBox}>
          {eventLog.length === 0 ? (
            <Text style={s.logEmpty}>No events yet. Walk to a location!</Text>
          ) : (
            eventLog.map((ev, i) => (
              <View key={i} style={s.logRow}>
                <Text style={[s.logTag, { color: eventColor(ev.tag) }]}>
                  {eventIcon(ev.tag)} {ev.tag}
                </Text>
                <Text style={s.logSummary}>{ev.summary}</Text>
              </View>
            ))
          )}
        </View>

        {/* ─ Guide ─ */}
        <View style={s.guide}>
          <Text style={s.guideTitle}>📋 Test Checklist</Text>
          {[
            '1️⃣  Walk to "Main Entrance"',
            '2️⃣  Set destination to "Registration Desk"',
            '3️⃣  Watch route_started event',
            '4️⃣  Tap ⚠️ Approaching → see approaching_turn event',
            '5️⃣  Tap 🔄 Turn Now! → see turn_now event',
            '6️⃣  Walk to Registration → see arrived event',
            '7️⃣  Walk somewhere off-route → see reroute event',
            '8️⃣  Toggle Obstacles ON while walking',
          ].map((step, i) => (
            <Text key={i} style={s.guideStep}>{step}</Text>
          ))}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── InfoRow component ───────────────────────────────────────────────────────

function InfoRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={[s.infoValue, highlight && { color: '#FFD54F' }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0D1117' },
  scroll: { padding: 16, paddingTop: 8 },

  title:    { color: '#F0F6FC', fontSize: 24, fontWeight: '800', textAlign: 'center', marginTop: 8 },
  subtitle: { color: '#8B949E', fontSize: 12, textAlign: 'center', marginBottom: 16 },

  // Cards
  card: {
    backgroundColor: '#161B22', borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 1, borderColor: '#30363D',
  },
  turnCard: {
    backgroundColor: '#1A1200', borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 1, borderColor: '#FFD600',
  },
  closenessCard: {
    backgroundColor: '#001020', borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 1, borderColor: '#40C4FF',
  },
  closenessCardDisabled: {
    backgroundColor: '#0D1117', borderRadius: 14, padding: 12,
    marginBottom: 14, borderWidth: 1, borderColor: '#30363D',
    alignItems: 'center',
  },
  closenessHint: { color: '#8B949E', fontSize: 11, marginBottom: 10, lineHeight: 16 },
  closenessThresholds: { color: '#8B949E', fontSize: 10, textAlign: 'center', marginBottom: 8 },
  turnTitle: { color: '#FFD600', fontSize: 15, fontWeight: '800', marginBottom: 10 },

  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  row2: { flexDirection: 'row', gap: 8, marginTop: 12 },

  badge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  badgeText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  cancelBtn: { backgroundColor: '#E5393533', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1, borderColor: '#E53935' },
  cancelBtnText: { color: '#E53935', fontSize: 12, fontWeight: '600' },

  infoRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 5, gap: 8 },
  infoLabel: { color: '#8B949E', fontSize: 12, fontWeight: '600', minWidth: 80 },
  infoValue: { color: '#F0F6FC', fontSize: 12, flex: 1, flexWrap: 'wrap' },

  // Turn buttons
  warnBtn: {
    flex: 1, backgroundColor: '#332800', borderRadius: 12, padding: 12,
    alignItems: 'center', borderWidth: 1, borderColor: '#FFD600',
  },
  warnBtnTxt: { color: '#FFD600', fontSize: 13, fontWeight: '700' },
  warnBtnSub: { color: '#8B8060', fontSize: 10, marginTop: 3 },

  turnBtn: {
    flex: 1, backgroundColor: '#330010', borderRadius: 12, padding: 12,
    alignItems: 'center', borderWidth: 1, borderColor: '#FF1744',
  },
  turnBtnTxt: { color: '#FF1744', fontSize: 13, fontWeight: '700' },
  turnBtnSub: { color: '#806070', fontSize: 10, marginTop: 3 },

  // Section
  section: { color: '#F0F6FC', fontSize: 16, fontWeight: '700', marginTop: 8, marginBottom: 4 },
  hint:    { color: '#8B949E', fontSize: 11, marginBottom: 8 },

  // Node grid
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },

  nodeBtn: {
    borderWidth: 2, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 9,
    minWidth: '45%' as any, flexGrow: 1, alignItems: 'center',
    backgroundColor: '#161B22',
  },
  nodeBtnTxt: { color: '#F0F6FC', fontSize: 11, fontWeight: '600', textAlign: 'center' },

  destBtn: {
    borderWidth: 1, borderColor: '#FFD54F', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 9,
    minWidth: '45%' as any, flexGrow: 1, alignItems: 'center',
    backgroundColor: '#161B22',
  },
  destBtnActive: { backgroundColor: '#FFD54F' },
  destBtnTxt: { color: '#FFD54F', fontSize: 11, fontWeight: '600', textAlign: 'center' },

  // Drift test
  driftBtn: {
    flex: 1, backgroundColor: '#001B33', borderRadius: 12, padding: 12,
    alignItems: 'center', borderWidth: 1, borderColor: '#40C4FF',
  },
  driftBtnTxt: { color: '#40C4FF', fontSize: 13, fontWeight: '700' },
  driftBtnSub: { color: '#406070', fontSize: 10, marginTop: 3 },
  recenterBtn: {
    flex: 1, backgroundColor: '#001500', borderRadius: 12, padding: 12,
    alignItems: 'center', borderWidth: 2, borderColor: '#00E676',
  },
  recenterBtnTxt: { color: '#00E676', fontSize: 13, fontWeight: '700' },

  // Toggle
  toggleBtn: {
    backgroundColor: '#161B22', borderRadius: 12, padding: 12,
    alignItems: 'center', marginTop: 4, marginBottom: 16,
    borderWidth: 1, borderColor: '#30363D',
  },
  toggleBtnOn: { borderColor: '#FF9800', backgroundColor: '#FF980015' },
  toggleBtnTxt: { color: '#F0F6FC', fontSize: 13, fontWeight: '600' },

  // Closeness Stepper
  stepperLabel: { color: '#8B949E', fontSize: 12, fontWeight: '600', marginTop: 12, marginBottom: 6 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepperBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#222', borderWidth: 1, borderColor: '#555',
    alignItems: 'center', justifyContent: 'center',
  },
  stepperBtnTxt: { color: '#fff', fontSize: 20, fontWeight: '700', lineHeight: 24 },
  stepperBar: {
    flex: 1, height: 18, backgroundColor: '#1a1a1a',
    borderRadius: 9, overflow: 'hidden', position: 'relative',
    borderWidth: 1, borderColor: '#333',
  },
  stepperFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 9 },
  stepperMark: {
    position: 'absolute', top: 0, bottom: 0,
    width: 2, backgroundColor: '#FFD600',
  },
  stepperValue: {
    color: '#F0F6FC', fontSize: 12, fontWeight: '600',
    textAlign: 'center', marginTop: 6, marginBottom: 8,
  },

  // Fire button
  fireBtn: {
    borderRadius: 12, padding: 12, alignItems: 'center',
    borderWidth: 1, marginTop: 4,
  },
  fireBtnTxt: { fontSize: 14, fontWeight: '800' },

  // Event log
  logBox: {
    backgroundColor: '#0D1117', borderRadius: 12, padding: 12,
    marginBottom: 14, borderWidth: 1, borderColor: '#30363D',
    maxHeight: 360,
  },
  logEmpty: { color: '#484F58', fontSize: 12, fontStyle: 'italic', textAlign: 'center' },
  logRow:   { marginBottom: 10, borderBottomWidth: 1, borderBottomColor: '#1E1E1E', paddingBottom: 8 },
  logTag:   { fontSize: 12, fontWeight: '700', marginBottom: 2 },
  logSummary: { color: '#8B949E', fontSize: 11, lineHeight: 16 },

  // Guide
  guide: {
    backgroundColor: '#161B22', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#1E88E544',
  },
  guideTitle: { color: '#90CAF9', fontSize: 14, fontWeight: '700', marginBottom: 8 },
  guideStep:  { color: '#8B949E', fontSize: 12, marginBottom: 5, lineHeight: 18 },
});
