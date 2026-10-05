/**
 * MOCK ONLY — in-memory stand-in for the FastAPI + SQLite backend.
 * Seeds 30 days of plausible footfall history per camera.
 */
import { DEFAULT_CONFIG } from '@/config/constants';
import type { Camera, CameraConfig, CameraStatus, PersonCountEvent } from '@/types';
import { exp, mulberry32, range } from './random';

const STORAGE_KEY = 'footfall-mock-configs-v1';
const DAY_MS = 86_400_000;
const MIN_MS = 60_000;
const SEED_DAYS = 30;

export const MOCK_CAMERAS: Camera[] = [
  { camera_id: 'CAM_01', name: 'Main Entrance', location: 'Ground floor · North', source: 'rtsp://10.0.4.21:554/stream1', resolution: '1920 × 1080' },
  { camera_id: 'CAM_02', name: 'Side Entrance', location: 'Ground floor · East', source: 'rtsp://10.0.4.22:554/stream1', resolution: '1920 × 1080' },
  { camera_id: 'CAM_03', name: 'Loading Dock', location: 'Rear · Service', source: 'rtsp://10.0.4.23:554/stream1', resolution: '1280 × 720' },
  // Real recorded footage (public/videos/ATTRIBUTION.md). Plays as the stream; tracks and counts come from the backend.
  { camera_id: 'CAM_04', name: 'Sample Footage', location: 'Recorded clip · Lobby', source: 'videos/footfall-sample.mp4', resolution: '768 × 432', stream_url: '/videos/footfall-sample.mp4' },
];

/** Relative visitor arrival rate per hour of day (store open ~07–22). */
const HOURLY_PROFILE = [0, 0, 0, 0, 0, 0, 0.05, 0.25, 0.45, 0.6, 0.75, 0.9, 1, 0.95, 0.8, 0.75, 0.85, 1, 0.95, 0.75, 0.5, 0.3, 0.1, 0];
const CAMERA_TRAFFIC: Record<string, number> = { CAM_01: 34, CAM_02: 14, CAM_03: 4, CAM_04: 0 };

interface MockDb {
  cameras: Camera[];
  configs: Map<string, CameraConfig>;
  events: PersonCountEvent[]; // ascending by timestamp
  ids: Set<string>;
  nextTrack: Map<string, number>;
  status: Map<string, CameraStatus>;
  countsResetAt: Map<string, number>;
  startedAt: number;
}

let db: MockDb | null = null;
let eventSeq = 0;

export const nextEventId = () => `evt_${String(++eventSeq).padStart(6, '0')}`;

function loadConfigs(): Map<string, CameraConfig> {
  const map = new Map<string, CameraConfig>();
  for (const c of MOCK_CAMERAS) map.set(c.camera_id, { camera_id: c.camera_id, ...structuredClone(DEFAULT_CONFIG) });
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) for (const cfg of JSON.parse(raw) as CameraConfig[]) map.set(cfg.camera_id, cfg);
  } catch {
    /* storage unavailable — defaults are fine */
  }
  return map;
}

export function persistConfigs() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...getDb().configs.values()]));
  } catch {
    /* ignore */
  }
}

function seedEvents(cameraId: string, now: number, onTrackCounter: (next: number) => void) {
  const rnd = mulberry32(cameraId.length * 7919 + Math.floor(now / DAY_MS));
  const perHour = CAMERA_TRAFFIC[cameraId] ?? 10;
  const visits: Array<{ t: number; dir: 'ENTRY' | 'EXIT'; track: number }> = [];
  const start = new Date(now - (SEED_DAYS - 1) * DAY_MS);
  start.setHours(0, 0, 0, 0);
  let counter = 1;
  const nextTrack = () => counter++;
  for (let day = start.getTime(); day < now; day += DAY_MS) {
    counter = 1; // tracker IDs restart daily
    const dayFactor = range(rnd, 0.8, 1.2) * ([0, 6].includes(new Date(day).getDay()) ? 1.25 : 1);
    const closing = day + 22.5 * 3_600_000;
    for (let h = 0; h < 24; h++) {
      const rate = perHour * HOURLY_PROFILE[h] * dayFactor;
      let t = day + h * 3_600_000;
      const hourEnd = t + 3_600_000;
      while (rate > 0) {
        t += exp(rnd, 3_600_000 / rate);
        if (t >= hourEnd || t >= now) break;
        const track = nextTrack();
        visits.push({ t, dir: 'ENTRY', track });
        const leave = Math.min(t + MIN_MS * (5 + exp(rnd, 22)), closing + rnd() * 20 * MIN_MS);
        if (leave < now) visits.push({ t: leave, dir: 'EXIT', track: nextTrack() });
      }
    }
  }
  onTrackCounter(counter);
  visits.sort((a, b) => a.t - b.t);
  return visits.map<PersonCountEvent>((v) => ({
    event_id: nextEventId(),
    camera_id: cameraId,
    track_id: v.track,
    direction: v.dir,
    timestamp: new Date(Math.floor(v.t)).toISOString(),
    confidence: +range(rnd, 0.82, 0.98).toFixed(2),
  }));
}

export function getDb(): MockDb {
  if (db) return db;
  const now = Date.now();
  const nextTrack = new Map<string, number>();
  const events: PersonCountEvent[] = [];
  for (const cam of MOCK_CAMERAS) {
    events.push(...seedEvents(cam.camera_id, now, (next) => nextTrack.set(cam.camera_id, next)));
  }
  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  db = {
    cameras: structuredClone(MOCK_CAMERAS),
    configs: loadConfigs(),
    events,
    ids: new Set(events.map((e) => e.event_id)),
    nextTrack,
    status: new Map(),
    countsResetAt: new Map(),
    startedAt: now - (3 * 3600 + 24 * 60 + 12) * 1000,
  };
  return db;
}

export function allocTrack(cameraId: string) {
  const d = getDb();
  const id = d.nextTrack.get(cameraId) ?? 1;
  d.nextTrack.set(cameraId, id + 1);
  return id;
}

/** Mirrors the backend contract: duplicate IDs are rejected (409). */
export function insertEvent(e: PersonCountEvent) {
  const d = getDb();
  if (d.ids.has(e.event_id)) throw new Error('Event already exists');
  d.ids.add(e.event_id);
  d.events.push(e);
}
