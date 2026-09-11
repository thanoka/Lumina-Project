import { LocationNode, LocationMatch, Route, NavStep, FrameResponse, TurnRef } from './types';
import { getBestMatch } from './locationMatcher';
import { planRoute, getNodeById, getDestinations } from './routePlanner';
import { processSafetyDetections, SafetyAlert } from './safetyAnnouncer';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Maps a 3-column grid position to a numeric column index.
 * left = -1 | center = 0 | right = +1
 * Height is intentionally ignored — only horizontal alignment matters.
 */
function getGridColumn(grid: string): number | null {
  if (grid === 'left')   return -1;
  if (grid === 'center') return  0;
  if (grid === 'right')  return  1;
  return null; // unknown value — skip this detection
}

/** Check if a detected object matches a TurnRef */
function matchesTurnRef(
  detections: FrameResponse['detections'],
  ref: TurnRef
): { matched: boolean; size_pct: number } {
  for (const det of detections) {
    const labelOk = det.label.toLowerCase() === ref.object_name.toLowerCase();
    const textOk  = ref.text_content
      ? det.text_content?.toUpperCase().includes(ref.text_content.toUpperCase())
      : true;
    if (labelOk && textOk) {
      return { matched: true, size_pct: det.size_pct };
    }
  }
  return { matched: false, size_pct: 0 };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type NavState =
  | 'idle'
  | 'locating'
  | 'navigating'
  | 'arrived'
  | 'lost'
  | 'rerouting';

export type EventTag =
  | 'location_update'
  | 'navigation_step'
  | 'waypoint_reached'
  | 'arrived'
  | 'reroute'
  | 'warning'
  | 'danger'
  | 'approaching_turn'   // ref object visible at warn_at size → prepare to turn
  | 'turn_now'           // ref object visible at turn_at size → execute turn
  | 'alignment_correction'
  | 'sign_read'
  | 'guidance_needed'
  | 'destination_set'
  | 'navigation_cancelled'
  | 'already_there'
  | 'no_route'
  | 'route_started';

export interface NavEvent {
  tag: EventTag;
  summary: string;
  data: Record<string, any>;
}

export interface NavOutput {
  state: NavState;
  current_location: { id: string; name: string; confidence: number } | null;
  destination: { id: string; name: string } | null;
  route: {
    step_index: number;
    total_steps: number;
    current_step: {
      direction: string;
      distance: string;
      path_type: string;
      from: string;
      to: string;
      instruction: string;
      turn_ref?: TurnRef;
    } | null;
  } | null;
  safety: SafetyAlert[];
  events: NavEvent[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LOCATION_CONFIRM_THRESHOLD = 0.40;
const LOCATION_HISTORY_SIZE      = 3;
const GUIDANCE_DELAY_MS          = 4000;
const GUIDANCE_INTERVAL_MS       = 8000;

// ─── Engine ───────────────────────────────────────────────────────────────────

export class NavigationEngine {
  private mapNodes: LocationNode[];
  private destination: string | null = null;
  private currentRoute: Route | null = null;
  private currentStepIndex = 0;
  private state: NavState  = 'idle';

  private lastKnownLocation: string | null = null;
  private locationHistory: LocationMatch[] = [];

  private lastSignTime     = 0;
  private routeAnnouncedAt = new Set<number>();

  private locatingStartTime = 0;
  private lastGuidanceTime  = 0;

  /** Tracks which turn phase has already been announced for the current step */
  private turnPhaseAnnounced: 'none' | 'approaching' | 'now' = 'none';

  /**
   * Cooldown tracker for alignment_correction events.
   * Key: "objectName|expectedGrid" — value: last fire timestamp.
   * Prevents spamming the same correction every frame.
   */
  private alignmentCooldown = new Map<string, number>();
  private static readonly ALIGNMENT_COOLDOWN_MS = 3000;

  constructor(mapNodes: LocationNode[]) {
    this.mapNodes = mapNodes;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  setDestination(destId: string): NavEvent[] {
    const events: NavEvent[] = [];
    this.destination = destId;
    this.currentStepIndex = 0;
    this.routeAnnouncedAt.clear();
    this.turnPhaseAnnounced = 'none';

    const destNode = getNodeById(this.mapNodes, destId);
    if (!destNode) {
      this.state = 'idle';
      this.destination = null;
      events.push({ tag: 'no_route', summary: `Destination ${destId} not found`, data: { destination_id: destId } });
      return events;
    }

    if (this.lastKnownLocation) {
      if (this.lastKnownLocation === destId) {
        this.state = 'arrived';
        this.destination = null;
        events.push({
          tag: 'already_there',
          summary: `User is already at ${destNode.name}`,
          data: { location_id: destId, location_name: destNode.name },
        });
        return events;
      }

      const route = planRoute(this.mapNodes, this.lastKnownLocation, destId);
      if (route) {
        this.currentRoute = route;
        this.state = 'navigating';
        const firstStep = route.steps[0];
        events.push({
          tag: 'route_started',
          summary: `Route to ${destNode.name}: ${route.totalSteps} steps`,
          data: {
            destination_id:   destId,
            destination_name: destNode.name,
            total_steps:      route.totalSteps,
            first_step:       this.stepSummary(firstStep),
          },
        });
      } else {
        events.push({ tag: 'no_route', summary: `No path to ${destNode.name}`, data: { destination_id: destId } });
      }
      return events;
    }

    // No known position yet — wait for locating
    this.state = 'locating';
    this.locatingStartTime = Date.now();
    this.lastGuidanceTime  = 0;
    events.push({
      tag: 'destination_set',
      summary: `Destination set to ${destNode.name}, locating user`,
      data: { destination_id: destId, destination_name: destNode.name, state: 'locating' },
    });
    return events;
  }

  cancelNavigation(): NavEvent {
    this.destination   = null;
    this.currentRoute  = null;
    this.currentStepIndex = 0;
    this.state         = 'idle';
    this.routeAnnouncedAt.clear();
    this.turnPhaseAnnounced = 'none';
    return { tag: 'navigation_cancelled', summary: 'Navigation cancelled', data: {} };
  }

  getAvailableDestinations(): { id: string; name: string }[] {
    return getDestinations(this.mapNodes);
  }

  getState(): NavState { return this.state; }
  getCurrentLocation(): string | null { return this.lastKnownLocation; }
  getRoute(): Route | null { return this.currentRoute; }
  getDestinationId(): string | null { return this.destination; }

  // ── Main per-frame pipeline ─────────────────────────────────────────────────

  processFrame(frameData: FrameResponse): NavOutput {
    const events: NavEvent[] = [];

    // 1) Safety
    const alerts = processSafetyDetections(frameData.detections);
    for (const alert of alerts) {
      events.push({
        tag: alert.tag,
        summary: `${alert.tag === 'danger' ? 'DANGER' : 'Warning'}: ${alert.object} at ${alert.direction}`,
        data: { object: alert.object, direction: alert.direction, size_pct: alert.size_pct },
      });
    }

    // 2) Location matching
    const match = getBestMatch(frameData.detections, this.mapNodes);
    let currentLoc: NavOutput['current_location'] = null;

    if (match && match.confidence >= LOCATION_CONFIRM_THRESHOLD) {
      this.locationHistory.push(match);
      if (this.locationHistory.length > LOCATION_HISTORY_SIZE) this.locationHistory.shift();

      const stableLocation = this.getStableLocation();
      if (stableLocation) {
        const locationChanged = this.lastKnownLocation !== stableLocation;
        this.lastKnownLocation = stableLocation;
        const node = getNodeById(this.mapNodes, stableLocation);

        currentLoc = {
          id:         stableLocation,
          name:       node?.name || stableLocation,
          confidence: Math.round(match.confidence * 100),
        };

        if (locationChanged) {
          events.push({
            tag:     'location_update',
            summary: `User is now at ${node?.name || stableLocation}`,
            data:    { location_id: stableLocation, location_name: node?.name, confidence: currentLoc.confidence },
          });
        }

        // 3) Trigger route planning if we just found position while locating
        if (this.state === 'locating' && this.destination) {
          const routeEvents = this.setDestination(this.destination);
          events.push(...routeEvents);
        }

        // 4) Update route progress
        if (this.state === 'navigating' && this.currentRoute) {
          const routeEvents = this.updateRouteProgress(stableLocation);
          events.push(...routeEvents);
        }
      }
    } else if (this.state === 'navigating' && this.locationHistory.length === 0) {
      this.state = 'lost';
    }

    // 5) Turn ref monitoring (while navigating and NOT at a stable node yet)
    if (this.state === 'navigating' && this.currentRoute) {
      const turnEvents = this.checkTurnRef(frameData);
      events.push(...turnEvents);
    }

    // 6) Sign text (unknown signs)
    if (frameData.can_read_sign && frameData.sign_text) {
      const now = Date.now();
      if (now - this.lastSignTime > 5000) {
        const isKnown = this.mapNodes.some(n =>
          n['reference-point'].some(r =>
            r.text_content && frameData.sign_text.toUpperCase().includes(r.text_content.toUpperCase())
          )
        );
        if (!isKnown) {
          events.push({ tag: 'sign_read', summary: `Sign: "${frameData.sign_text}"`, data: { text: frameData.sign_text } });
          this.lastSignTime = now;
        }
      }
    }

    // 7) Alignment correction (while navigating)
    if (this.state === 'navigating' && match && match.confidence >= 0.2) {
      const node = getNodeById(this.mapNodes, match.nodeId);
      if (node) {
        for (const ref of node['reference-point']) {
          const det = frameData.detections.find(d =>
            d.label.toLowerCase() === ref.object_name.toLowerCase() ||
            (d.text_content && ref.text_content &&
             d.text_content.toUpperCase().includes(ref.text_content.toUpperCase()))
          );
          if (!det) continue;

          const expectedCol = getGridColumn(ref.location_in_frame);
          const detectedCol = getGridColumn(det.grid_location);
          if (expectedCol === null || detectedCol === null) continue;

          const objKey = `${ref.object_name}|${ref.location_in_frame}`;
          const now    = Date.now();

          if (detectedCol === expectedCol) {
            // ✅ Aligned — just log, no event
            console.log(`[ALIGNMENT OK] "${ref.text_content || ref.object_name}" is correctly at ${ref.location_in_frame}`);
            this.alignmentCooldown.delete(objKey); // reset cooldown when aligned
            break;
          }

          // ❌ Not aligned — check cooldown before firing event
          const lastFired = this.alignmentCooldown.get(objKey) ?? 0;
          if (now - lastFired < NavigationEngine.ALIGNMENT_COOLDOWN_MS) {
            // Still in cooldown — log but don't re-fire event
            console.log(`[ALIGNMENT] Still off: "${ref.text_content || ref.object_name}" at ${det.grid_location}, expected ${ref.location_in_frame} (cooldown)`);
            break;
          }

          // Fire correction event
          // Physical model: sign appears at LEFT of frame → user drifted RIGHT → turn_right to correct
          //                 sign appears at RIGHT of frame → user drifted LEFT → turn_left to correct
          // The correction steers OPPOSITE to the sign's position — back toward center.
          const suggestion = detectedCol < expectedCol ? 'turn_right' : 'turn_left';
          console.log(`[ALIGNMENT NOT OK] "${ref.text_content || ref.object_name}" at ${det.grid_location} (col ${detectedCol}), expected ${ref.location_in_frame} (col ${expectedCol}) → ${suggestion}`);

          events.push({
            tag:     'alignment_correction',
            summary: `"${ref.text_content || ref.object_name}" expected at ${ref.location_in_frame} but detected at ${det.grid_location}. Suggest: ${suggestion}`,
            data:    {
              object:         ref.text_content || ref.object_name,
              expected_grid:  ref.location_in_frame,
              detected_grid:  det.grid_location,
              suggestion,
            },
          });
          this.alignmentCooldown.set(objKey, now);
          break;
        }
      }
    }

    // 8) Localization guidance
    if (this.state === 'locating' && !match) {
      const now = Date.now();
      if (now - this.locatingStartTime > GUIDANCE_DELAY_MS &&
          now - this.lastGuidanceTime  > GUIDANCE_INTERVAL_MS) {
        events.push({
          tag:     'guidance_needed',
          summary: 'Cannot determine position — rotate slowly to scan surroundings',
          data:    { seconds_searching: Math.round((now - this.locatingStartTime) / 1000) },
        });
        this.lastGuidanceTime = now;
      }
    }

    // ── Build output ──
    let routeInfo: NavOutput['route'] = null;
    if (this.currentRoute) {
      const step = this.currentRoute.steps[this.currentStepIndex];
      routeInfo = {
        step_index:   this.currentStepIndex,
        total_steps:  this.currentRoute.totalSteps,
        current_step: step ? {
          direction: step.direction,
          distance:  step.distance,
          path_type: step.pathType,
          from:      step.from,
          to:        step.to,
          instruction: step.instruction,
          turn_ref:  step.turn_ref,
        } : null,
      };
    }

    let destInfo: NavOutput['destination'] = null;
    if (this.destination) {
      const destNode = getNodeById(this.mapNodes, this.destination);
      destInfo = { id: this.destination, name: destNode?.name || this.destination };
    }

    return {
      state: this.state,
      current_location: currentLoc || (this.lastKnownLocation ? {
        id:         this.lastKnownLocation,
        name:       getNodeById(this.mapNodes, this.lastKnownLocation)?.name || this.lastKnownLocation,
        confidence: 0,
      } : null),
      destination: destInfo,
      route:       routeInfo,
      safety:      alerts,
      events,
    };
  }

  // ── Turn Ref Monitoring ─────────────────────────────────────────────────────

  private checkTurnRef(frameData: FrameResponse): NavEvent[] {
    const events: NavEvent[] = [];
    if (!this.currentRoute) return events;

    const step = this.currentRoute.steps[this.currentStepIndex];
    if (!step?.turn_ref) return events;

    const ref = step.turn_ref;
    const { matched, size_pct } = matchesTurnRef(frameData.detections, ref);
    if (!matched) return events;

    if (size_pct >= ref.turn_at && this.turnPhaseAnnounced !== 'now') {
      this.turnPhaseAnnounced = 'now';
      events.push({
        tag:     'turn_now',
        summary: `Turn ${step.direction} now! "${ref.text_content || ref.object_name}" is very close (${Math.round(size_pct * 100)}% of frame)`,
        data: {
          direction:   step.direction,
          landmark:    ref.text_content || ref.object_name,
          size_pct,
          turn_at:     ref.turn_at,
          step_index:  this.currentStepIndex,
          to_name:     step.destinationName,
        },
      });
    } else if (size_pct >= ref.warn_at && this.turnPhaseAnnounced === 'none') {
      this.turnPhaseAnnounced = 'approaching';
      events.push({
        tag:     'approaching_turn',
        summary: `Prepare to turn ${step.direction} — "${ref.text_content || ref.object_name}" approaching (${Math.round(size_pct * 100)}% of frame)`,
        data: {
          direction:   step.direction,
          landmark:    ref.text_content || ref.object_name,
          size_pct,
          warn_at:     ref.warn_at,
          turn_at:     ref.turn_at,
          step_index:  this.currentStepIndex,
        },
      });
    }

    return events;
  }

  // ── Route Progress ──────────────────────────────────────────────────────────

  private getStableLocation(): string | null {
    if (this.locationHistory.length < 2) return null;
    const recent = this.locationHistory.slice(-2);
    return recent.every(m => m.nodeId === recent[0].nodeId) ? recent[0].nodeId : null;
  }

  private updateRouteProgress(currentNodeId: string): NavEvent[] {
    const events: NavEvent[] = [];
    if (!this.currentRoute || !this.destination) return events;

    // Arrived at destination
    if (currentNodeId === this.destination) {
      this.state = 'arrived';
      const destNode = getNodeById(this.mapNodes, this.destination);
      events.push({
        tag:     'arrived',
        summary: `Arrived at ${destNode?.name || this.destination}`,
        data:    { location_id: this.destination, location_name: destNode?.name, arrival_message: destNode?.instruction_on_arrival || '' },
      });
      this.destination  = null;
      this.currentRoute = null;
      return events;
    }

    // Check which step
    for (let i = 0; i < this.currentRoute.steps.length; i++) {
      const step = this.currentRoute.steps[i];

      if (step.from === currentNodeId && !this.routeAnnouncedAt.has(i)) {
        this.currentStepIndex   = i;
        this.turnPhaseAnnounced = 'none'; // Reset turn state for new step
        events.push({
          tag:     'navigation_step',
          summary: `Step ${i + 1}/${this.currentRoute.totalSteps}: ${step.instruction}`,
          data:    this.stepData(step, i),
        });
        this.routeAnnouncedAt.add(i);
        return events;
      }

      if (step.to === currentNodeId && i < this.currentRoute.steps.length - 1) {
        const nextStep = this.currentRoute.steps[i + 1];
        if (!this.routeAnnouncedAt.has(i + 1)) {
          this.currentStepIndex   = i + 1;
          this.turnPhaseAnnounced = 'none';
          const wayNode = getNodeById(this.mapNodes, currentNodeId);
          events.push({
            tag:     'waypoint_reached',
            summary: `Passed through ${wayNode?.name || currentNodeId}`,
            data:    { waypoint_id: currentNodeId, waypoint_name: wayNode?.name, arrival_message: wayNode?.instruction_on_arrival || '' },
          });
          events.push({
            tag:     'navigation_step',
            summary: `Step ${i + 2}/${this.currentRoute.totalSteps}: ${nextStep.instruction}`,
            data:    this.stepData(nextStep, i + 1),
          });
          this.routeAnnouncedAt.add(i + 1);
        }
        return events;
      }
    }

    // Off-route → reroute
    const isOnRoute = this.currentRoute.steps.some(
      s => s.from === currentNodeId || s.to === currentNodeId
    );

    if (!isOnRoute) {
      this.state = 'rerouting';
      const reroute = planRoute(this.mapNodes, currentNodeId, this.destination);
      if (reroute) {
        this.currentRoute       = reroute;
        this.currentStepIndex   = 0;
        this.turnPhaseAnnounced = 'none';
        this.routeAnnouncedAt.clear();
        const firstStep = reroute.steps[0];
        events.push({
          tag:     'reroute',
          summary: `Off-route — new path: ${reroute.totalSteps} steps`,
          data: {
            new_total_steps:       reroute.totalSteps,
            reason:                'user_off_route',
            current_location_id:   currentNodeId,
            current_location_name: getNodeById(this.mapNodes, currentNodeId)?.name || currentNodeId,
            first_step:            this.stepSummary(firstStep),
          },
        });
        if (firstStep) this.routeAnnouncedAt.add(0);
        this.state = 'navigating';
      } else {
        events.push({ tag: 'no_route', summary: 'No alternative route found', data: { from: currentNodeId, to: this.destination } });
        this.state = 'lost';
      }
    }

    return events;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private stepSummary(step: NavStep | undefined): Record<string, any> | null {
    if (!step) return null;
    return {
      direction:  step.direction,
      distance:   step.distance,
      path_type:  step.pathType,
      to_name:    step.destinationName,
      instruction: step.instruction,
      has_turn_ref: !!step.turn_ref,
    };
  }

  private stepData(step: NavStep, index: number): Record<string, any> {
    return {
      step_index:   index,
      total_steps:  this.currentRoute?.totalSteps,
      direction:    step.direction,
      distance:     step.distance,
      path_type:    step.pathType,
      from_id:      step.from,
      to_id:        step.to,
      to_name:      step.destinationName,
      instruction:  step.instruction,
      has_turn_ref: !!step.turn_ref,
      turn_ref:     step.turn_ref ?? null,
    };
  }
}
