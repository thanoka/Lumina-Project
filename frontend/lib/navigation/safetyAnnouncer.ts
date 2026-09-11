import { Detection } from './types';

const WARNING_THRESHOLD = 0.5;
const DANGER_THRESHOLD = 0.8;

const ANNOUNCE_COOLDOWN_MS = 5000;

export type SafetyTag = 'warning' | 'danger';

export interface SafetyAlert {
  tag: SafetyTag;
  object: string;
  direction: string;
  size_pct: number;
}

const recentAnnouncements = new Map<string, number>();

function getKey(label: string, grid: string): string {
  return `${label}::${grid}`;
}

function shouldAnnounce(key: string): boolean {
  const last = recentAnnouncements.get(key);
  if (!last) return true;
  return Date.now() - last > ANNOUNCE_COOLDOWN_MS;
}

function markAnnounced(key: string): void {
  recentAnnouncements.set(key, Date.now());
}

export function cleanupAnnouncements(): void {
  const now = Date.now();
  for (const [key, time] of recentAnnouncements.entries()) {
    if (now - time > ANNOUNCE_COOLDOWN_MS * 3) {
      recentAnnouncements.delete(key);
    }
  }
}

export function processSafetyDetections(detections: Detection[]): SafetyAlert[] {
  const safetyDetections = detections.filter(d => d.type === 'safety');
  const alerts: SafetyAlert[] = [];

  for (const det of safetyDetections) {
    let tag: SafetyTag | null = null;

    if (det.size_pct >= DANGER_THRESHOLD) {
      tag = 'danger';
    } else if (det.size_pct >= WARNING_THRESHOLD) {
      tag = 'warning';
    }

    if (!tag) continue;

    const key = getKey(det.label, det.grid_location);
    if (!shouldAnnounce(key)) continue;

    alerts.push({
      tag,
      object: det.label,
      direction: det.grid_location,
      size_pct: det.size_pct,
    });

    markAnnounced(key);
  }

  alerts.sort((a, b) => {
    if (a.tag !== b.tag) return a.tag === 'danger' ? -1 : 1;
    return b.size_pct - a.size_pct;
  });

  if (Math.random() < 0.1) cleanupAnnouncements();

  return alerts;
}
