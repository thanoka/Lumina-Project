/**
 * ─── Frame Simulator ─────────────────────────────────────────────────────────
 *
 * Generates fake FrameResponse data as if the Eyes server detected objects
 * at a specific map location. Used for testing the navigation system
 * without being physically at the hospital.
 *
 * Grid system: 3 horizontal columns only — left | center | right
 * Height is intentionally ignored (user's height does not affect accuracy).
 */

import { FrameResponse, Detection, LocationNode } from './types';

/**
 * Generate a fake FrameResponse as if the camera is seeing the given location.
 *
 * @param node - The map node the user is currently "at"
 * @param includeObstacles - If true, adds random nearby obstacles for safety testing
 */
export function simulateFrame(
  node: LocationNode,
  includeObstacles: boolean = false
): FrameResponse {
  const detections: Detection[] = [];
  let signText = '';

  // ── 1) Reference-point detections ──
  for (const ref of node['reference-point']) {
    if (ref.text_content) {
      detections.push({
        label: 'SIGN',
        grid_location: ref.location_in_frame,
        size_pct: ref.priority === 1 ? 0.08 : ref.priority === 2 ? 0.04 : 0.02,
        type: 'text',
        text_content: ref.text_content,
      });
      if (ref.priority === 1) signText = ref.text_content;
    }

    if (ref.object_name !== 'sign') {
      detections.push({
        label: ref.object_name,
        grid_location: ref.location_in_frame,
        size_pct: ref.priority === 1 ? 0.10 : ref.priority === 2 ? 0.06 : 0.03,
        type: 'safety',
      });
    }
  }

  // ── 2) Parameter/ambient item detections ──
  const ambientGrids: ('left' | 'center' | 'right')[] = ['left', 'center', 'right'];
  for (const item of node.parameter_item) {
    if (Math.random() > 0.4) {
      const grid = ambientGrids[Math.floor(Math.random() * ambientGrids.length)];
      detections.push({
        label: item.object_name,
        grid_location: grid,
        size_pct: 0.01 + Math.random() * 0.03,
        type: item.object_name === 'sign' ? 'text' : 'safety',
        text_content: item.text_content || undefined,
      });
    }
  }

  // ── 3) Optional random obstacles ──
  if (includeObstacles) {
    const obstacles: { label: string; grid: 'left' | 'center' | 'right'; size: number }[] = [
      { label: 'person',       grid: 'center', size: 0.12 },
      { label: 'chair',        grid: 'left',   size: 0.08 },
      { label: 'potted plant', grid: 'right',  size: 0.06 },
      { label: 'dog',          grid: 'center', size: 0.18 },
    ];

    const count = 1 + Math.floor(Math.random() * 2);
    const shuffled = obstacles.sort(() => Math.random() - 0.5);
    for (let i = 0; i < count && i < shuffled.length; i++) {
      detections.push({
        label:        shuffled[i].label,
        grid_location: shuffled[i].grid,
        size_pct:     shuffled[i].size,
        type: 'safety',
      });
    }
  }

  return {
    status: 'success',
    detections,
    can_read_sign: signText.length > 0,
    sign_text: signText,
  };
}

/**
 * Generate a "transition" frame — simulates walking between two locations.
 * Returns a sparse frame with fewer detections (hallway/in-between state).
 */
export function simulateTransitionFrame(): FrameResponse {
  const detections: Detection[] = [];

  if (Math.random() > 0.5) {
    detections.push({
      label: 'SIGN',
      grid_location: 'center',
      size_pct: 0.02,
      type: 'text',
      text_content: 'EXIT',
    });
  }

  if (Math.random() > 0.3) {
    detections.push({
      label: 'chair',
      grid_location: 'right',
      size_pct: 0.02,
      type: 'safety',
    });
  }

  return {
    status: 'success',
    detections,
    can_read_sign: false,
    sign_text: '',
  };
}
