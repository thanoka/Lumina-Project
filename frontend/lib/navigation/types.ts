// ─── Types for the blind-navigation system ───

/** A single detection from the Eyes server */
export interface Detection {
  label: string;
  /** Horizontal column: 'left' | 'center' | 'right' */
  grid_location: 'left' | 'center' | 'right';
  size_pct: number;
  type: 'safety' | 'text';
  text_content?: string;
}

/** Server response from /process-frame */
export interface FrameResponse {
  status: string;
  detections: Detection[];
  can_read_sign: boolean;
  sign_text: string;
}

/** A reference point that identifies a location */
export interface ReferencePoint {
  object_name: string;
  text_content?: string;
  priority: number;
  description?: string;
  /** Horizontal column only: 'left' | 'center' | 'right' */
  location_in_frame: 'left' | 'center' | 'right';
}

/** An ambient/parameter item expected at a location */
export interface ParameterItem {
  object_name: string;
  count?: string;
  text_content?: string;
  description?: string;
}

/**
 * A landmark used to trigger a turn while walking along an edge.
 * When the object grows to `warn_at` size → fire `approaching_turn`.
 * When it reaches `turn_at` size → fire `turn_now`.
 */
export interface TurnRef {
  object_name: string;
  text_content?: string;
  warn_at: number;   // size_pct threshold for pre-turn warning  (e.g. 0.20)
  turn_at: number;   // size_pct threshold to execute the turn   (e.g. 0.30)
  description?: string;
}

/** A neighbor edge in the location graph */
export interface Neighbor {
  target_id: string;
  direction: string;
  distance_approx: string;
  path_type: string;
  /** Present only when the edge requires a turn (not forward/backward) */
  turn_ref?: TurnRef;
}

/** A node in the location map graph */
export interface LocationNode {
  id: string;
  name: string;
  type: 'place' | 'hall' | 'end';
  neighbors: Neighbor[];
  'reference-point': ReferencePoint[];
  parameter_item: ParameterItem[];
  instruction_on_arrival: string;
  mtype: string;
}

/** Navigation instruction for one step in a route */
export interface NavStep {
  from: string;
  to: string;
  direction: string;
  distance: string;
  pathType: string;
  destinationName: string;
  instruction: string;
  /** Carried from the edge — used to fire approaching_turn / turn_now events */
  turn_ref?: TurnRef;
}

/** Full route from A to B */
export interface Route {
  steps: NavStep[];
  totalSteps: number;
  destinationName: string;
}

/** Result of matching detections to a location */
export interface LocationMatch {
  nodeId: string;
  nodeName: string;
  confidence: number;     // 0–1
  matchedRefs: string[];  // which reference-points matched
}
