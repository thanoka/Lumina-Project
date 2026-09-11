/**
 * ─── Location Matcher ───────────────────────────────────────────────────────
 * 
 * Matches live YOLO+OCR detections from the Eyes server against the location
 * graph to determine WHERE the blind user currently is.
 * 
 * Matching strategy (priority order):
 *   1. SIGN TEXT match   — highest confidence (priority-1 reference-points with text)
 *   2. OBJECT match      — reference-point objects matched by label + grid location
 *   3. AMBIENT match     — parameter_item objects seen in frame (weaker signal)
 * 
 * Each match contributes a weighted score. The location with the highest
 * aggregate score above a confidence threshold is returned.
 */

import { Detection, LocationNode, LocationMatch } from './types';

const SIGN_TEXT_EXACT_WEIGHT = 0.50;  
const SIGN_TEXT_PARTIAL_WEIGHT = 0.30; 
const REF_OBJECT_GRID_WEIGHT = 0.20;  
const REF_OBJECT_LABEL_WEIGHT = 0.10;
const AMBIENT_OBJECT_WEIGHT = 0.05;  


const MIN_CONFIDENCE = 0.15;


function normalize(s: string): string {
  return (s || '').toLowerCase().replace(/[_-]/g, ' ').trim();
}


function labelsMatch(detected: string, expected: string): boolean {
  const d = normalize(detected);
  const e = normalize(expected);
  if (d === e) return true;


  const synonyms: Record<string, string[]> = {
    'tv': ['monitor', 'screen', 'display', 'television'],
    'monitor': ['tv', 'screen', 'display'],
    'dining table': ['table', 'desk', 'workstation'],
    'potted plant': ['plant', 'planter'],
    'cell phone': ['phone', 'mobile'],
    'fire hydrant': ['fire station', 'fire extinguisher'],
  };

  if (synonyms[d]?.includes(e) || synonyms[e]?.includes(d)) return true;

  return false;
}


function scoreLocation(
  node: LocationNode,
  detections: Detection[]
): { score: number; matchedRefs: string[] } {
  let score = 0;
  const matchedRefs: string[] = [];

  const textDetections = detections.filter(d => d.type === 'text');
  const allDetections = detections;


  for (const ref of node['reference-point']) {
    if (!ref.text_content) continue;
    const refText = normalize(ref.text_content);

    for (const det of textDetections) {
      if (!det.text_content) continue;
      const detText = normalize(det.text_content);

      if (detText === refText) {
        score += SIGN_TEXT_EXACT_WEIGHT * (1 / ref.priority); 
        matchedRefs.push(`SIGN_EXACT: "${ref.text_content}"`);
      } else if (detText.includes(refText) || refText.includes(detText)) {
        score += SIGN_TEXT_PARTIAL_WEIGHT * (1 / ref.priority);
        matchedRefs.push(`SIGN_PARTIAL: "${ref.text_content}"`);
      }
    }
  }

  for (const ref of node['reference-point']) {
    for (const det of allDetections) {
      if (labelsMatch(det.label, ref.object_name)) {
        if (det.grid_location === ref.location_in_frame) {
          score += REF_OBJECT_GRID_WEIGHT * (1 / ref.priority);
          matchedRefs.push(`REF_GRID: ${ref.object_name}@${ref.location_in_frame}`);
        } else {
          score += REF_OBJECT_LABEL_WEIGHT * (1 / ref.priority);
          matchedRefs.push(`REF_LABEL: ${ref.object_name}`);
        }
      }
    }
  }

  const detectedLabels = new Set(allDetections.map(d => normalize(d.label)));
  for (const item of node.parameter_item) {
    if (detectedLabels.has(normalize(item.object_name))) {
      score += AMBIENT_OBJECT_WEIGHT;

    }
  }

  return { score, matchedRefs };
}

export function matchLocation(
  detections: Detection[],
  mapNodes: LocationNode[]
): LocationMatch[] {
  if (!detections.length || !mapNodes.length) return [];

  const results: LocationMatch[] = [];


  let maxScore = 0;

  for (const node of mapNodes) {
    const { score, matchedRefs } = scoreLocation(node, detections);
    if (score > maxScore) maxScore = score;

    if (score > 0) {
      results.push({
        nodeId: node.id,
        nodeName: node.name,
        confidence: score, 
        matchedRefs,
      });
    }
  }

  if (maxScore > 0) {
    for (const r of results) {
      r.confidence = Math.min(1, r.confidence / maxScore);
    }
  }

  return results
    .filter(r => r.confidence >= MIN_CONFIDENCE)
    .sort((a, b) => b.confidence - a.confidence);
}


export function getBestMatch(
  detections: Detection[],
  mapNodes: LocationNode[]
): LocationMatch | null {
  const matches = matchLocation(detections, mapNodes);
  return matches.length > 0 ? matches[0] : null;
}
