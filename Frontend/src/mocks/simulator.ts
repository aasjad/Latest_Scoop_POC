/**
 * MOCK ONLY — stands in for the AI engine (YOLO + tracker + line-crossing logic).
 * People walk through the synthetic corridor; crossings of the *saved* counting
 * line are stored in the mock DB first and then broadcast, as the contract requires.
 */
import { FRAME } from '@/config/constants';
import { crossingDirection, projectionT, sideOf } from '@/lib/geometry';
import type { CameraStatus, CountingLine, PersonCountEvent, Point, Track, WsMessage } from '@/types';
import { allocTrack, getDb, insertEvent, nextEventId } from './db';
import { BACK, floorHalfWidth, personHeight, snapshotUri } from './scene';

const TICK_MS = 42;
const STATUS_MS = 2000;
const NEAR_EXIT_Y = 1090;
const FAR_Y = BACK.floor + 6;
const SIMULATED = ['CAM_01', 'CAM_02'];
const SPAWN_MEAN_MS: Record<string, number> = { CAM_01: 3600, CAM_02: 7000 };
const MAX_PEOPLE = 6;

export interface SimPerson {
  track_id: number;
  lane: number;
  wobble: number;
  fy: number;
  dirY: 1 | -1; // +1 walks toward the camera
  speed: number;
  phase: number;
  confidence: number;
  counted: 'ENTRY' | 'EXIT' | null;
  prevSide: number;
  trail: Point[];
}

type Listener = (msg: WsMessage) => void;

const listeners = new Set<Listener>();
const people = new Map<string, SimPerson[]>();
const nextSpawn = new Map<string, number>();
const degradedUntil = new Map<string, number>();
let timer: ReturnType<typeof setInterval> | null = null;
let statusTimer: ReturnType<typeof setInterval> | null = null;
let last = 0;

export const footPoint = (p: SimPerson): Point => {
  const x = 800 + (p.lane + Math.sin(p.wobble + p.fy / 140) * 0.03) * floorHalfWidth(p.fy);
  return { x: x / FRAME.w, y: p.fy / FRAME.h };
};

export function bboxOf(p: SimPerson): Track['bbox'] {
  const foot = footPoint(p);
  const h = personHeight(p.fy) * 1.04;
  const w = h * 0.4;
  return [foot.x - w / 2 / FRAME.w, (p.fy - h) / FRAME.h, w / FRAME.w, (h + 8) / FRAME.h];
}

export const getPeople = (cameraId: string) => people.get(cameraId) ?? [];

/** Is the far end of the corridor (where walkers appear) on side A of the line? */
const farSideIsA = (line: CountingLine) => sideOf(line, { x: 0.5, y: FAR_Y / FRAME.h }) < 0;

function emit(msg: WsMessage) {
  for (const l of listeners) l(msg);
}

function spawn(cameraId: string, now: number) {
  const list = people.get(cameraId) ?? [];
  const due = nextSpawn.get(cameraId) ?? 0;
  if (now < due || list.length >= MAX_PEOPLE) return;
  const mean = SPAWN_MEAN_MS[cameraId] ?? 5000;
  nextSpawn.set(cameraId, now + mean * (0.35 + Math.random() * 1.3));
  const db = getDb();
  const cutoff = db.countsResetAt.get(cameraId) ?? 0;
  let inside = 0;
  for (const e of db.events) if (e.camera_id === cameraId && Date.parse(e.timestamp) >= cutoff) inside += e.direction === 'ENTRY' ? 1 : -1;
  const pIn = inside <= 2 ? 0.85 : 0.56;
  const cfg = db.configs.get(cameraId);
  // Pick the walking direction that produces the desired count for the *current* line.
  const towardIsIn = cfg ? crossingDirection(farSideIsA(cfg.line), cfg.entry_direction) === 'ENTRY' : true;
  const wantsIn = Math.random() < pIn;
  const dirY: 1 | -1 = wantsIn === towardIsIn ? 1 : -1;
  list.push({
    track_id: allocTrack(cameraId),
    lane: (Math.random() - 0.5) * 1.2,
    wobble: Math.random() * Math.PI * 2,
    fy: dirY === 1 ? FAR_Y : NEAR_EXIT_Y,
    dirY,
    speed: 0.85 + Math.random() * 0.35,
    phase: Math.random() * Math.PI * 2,
    confidence: 0.84 + Math.random() * 0.13,
    counted: null,
    prevSide: 0,
    trail: [],
  });
  people.set(cameraId, list);
}

function makeEvent(cameraId: string, p: SimPerson, direction: 'ENTRY' | 'EXIT', at: number): PersonCountEvent {
  const foot = footPoint(p);
  return {
    event_id: nextEventId(),
    camera_id: cameraId,
    track_id: p.track_id,
    direction,
    timestamp: new Date(at).toISOString(),
    confidence: +p.confidence.toFixed(2),
    snapshot_url: snapshotUri(p.track_id, direction === 'ENTRY', Math.min(860, p.fy), foot.x * FRAME.w, p.dirY === -1),
  };
}

function step(cameraId: string, dt: number, now: number) {
  const db = getDb();
  const cfg = db.configs.get(cameraId);
  const list = people.get(cameraId) ?? [];
  const survivors: SimPerson[] = [];
  for (const p of list) {
    const depth = (p.fy - BACK.floor) / (FRAME.h - BACK.floor);
    p.fy += p.dirY * (40 + 150 * Math.max(0, depth)) * p.speed * dt;
    p.phase += dt * 7.5 * p.speed;
    const foot = footPoint(p);
    if (p.trail.length === 0 || Math.abs(p.trail[p.trail.length - 1].y - foot.y) > 0.012) {
      p.trail.push(foot);
      if (p.trail.length > 28) p.trail.shift();
    }
    if (cfg) {
      const side = sideOf(cfg.line, foot);
      const t = projectionT(cfg.line, foot);
      if (!p.counted && p.prevSide !== 0 && Math.sign(side) !== Math.sign(p.prevSide) && t >= 0 && t <= 1) {
        const direction = crossingDirection(p.prevSide < 0, cfg.entry_direction);
        const evt = makeEvent(cameraId, p, direction, now);
        insertEvent(evt); // store first …
        emit({ type: 'PERSON_COUNT_EVENT', data: evt }); // … then broadcast
        p.counted = direction;
      }
      p.prevSide = side;
    }
    const gone = p.dirY === 1 ? p.fy > NEAR_EXIT_Y : p.fy < FAR_Y;
    if (!gone) survivors.push(p);
  }
  people.set(cameraId, survivors);

  const tracks: Track[] = survivors.map((p) => {
    const foot = footPoint(p);
    let status: Track['status'] = 'tracking';
    if (p.counted) status = p.counted === 'ENTRY' ? 'entered' : 'exited';
    else if (cfg) {
      const t = projectionT(cfg.line, foot);
      if (t >= -0.05 && t <= 1.05) {
        const fromA = sideOf(cfg.line, foot) < 0;
        const onFarSide = fromA === farSideIsA(cfg.line);
        const approaching = onFarSide === (p.dirY === 1);
        if (approaching) status = crossingDirection(fromA, cfg.entry_direction) === 'ENTRY' ? 'entering' : 'exiting';
      }
    }
    const depth = (p.fy - BACK.floor) / (FRAME.h - BACK.floor);
    const confidence = Math.min(0.99, p.confidence - (1 - Math.min(1, depth)) * 0.07 + (Math.random() - 0.5) * 0.01);
    return { track_id: p.track_id, bbox: bboxOf(p), confidence: +confidence.toFixed(2), status, trail: [...p.trail] };
  });
  emit({ type: 'TRACKS_UPDATE', data: { camera_id: cameraId, tracks, frame_ts: new Date(now).toISOString() } });
}

function cameraStatus(cameraId: string, now: number): CameraStatus {
  const db = getDb();
  const cam = db.cameras.find((c) => c.camera_id === cameraId);
  const offline = !SIMULATED.includes(cameraId) && !cam?.stream_url;
  const degraded = (degradedUntil.get(cameraId) ?? 0) > now;
  const j = (base: number, spread: number) => +(base + (Math.random() - 0.5) * spread).toFixed(1);
  return {
    camera_id: cameraId,
    status: offline ? 'offline' : degraded ? 'degraded' : 'online',
    resolution: cam?.resolution ?? '1920 × 1080',
    camera_fps: offline ? 0 : degraded ? j(12.4, 0.8) : j(29.9, 0.2),
    inference_fps: offline ? 0 : degraded ? j(7.1, 0.6) : j(db.configs.get(cameraId)?.inference_fps ?? 15, 0.5),
    latency_ms: offline ? 0 : Math.round(degraded ? j(184, 18) : j(67, 8)),
    frame_drop_pct: offline ? 100 : degraded ? j(8.2, 0.8) : j(0.3, 0.3),
    model: 'YOLOv8n',
    uptime_s: offline ? 0 : Math.floor((now - db.startedAt) / 1000),
    active_tracks: offline ? 0 : (people.get(cameraId)?.length ?? 0),
    updated_at: new Date(now).toISOString(),
  };
}

export function currentStatus(cameraId: string) {
  const s = cameraStatus(cameraId, Date.now());
  getDb().status.set(cameraId, s);
  return s;
}

function broadcastStatus() {
  const now = Date.now();
  for (const cam of getDb().cameras) emit({ type: 'CAMERA_STATUS', data: currentStatus(cam.camera_id) });
  // Rare spontaneous degradation on the main camera to exercise the UI.
  if (Math.random() < 0.003) degradedUntil.set('CAM_01', now + 15_000);
}

export function startSimulator() {
  if (timer) return;
  last = performance.now();
  timer = setInterval(() => {
    const t = performance.now();
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    const now = Date.now();
    for (const cam of SIMULATED) {
      if ((degradedUntil.get(cam) ?? 0) > now && Math.random() < 0.45) continue; // dropped frames
      spawn(cam, now);
      step(cam, dt, now);
    }
  }, TICK_MS);
  statusTimer = setInterval(broadcastStatus, STATUS_MS);
}

export function stopSimulator() {
  if (timer) clearInterval(timer);
  if (statusTimer) clearInterval(statusTimer);
  timer = statusTimer = null;
}

export function subscribeSimulator(fn: Listener) {
  listeners.add(fn);
  startSimulator();
  return () => {
    listeners.delete(fn);
  };
}

// ── Demo controls (Settings → Demo tools) ───────────────────────────────────
export function simulateDegradation(cameraId: string, ms = 20_000) {
  degradedUntil.set(cameraId, Date.now() + ms);
  emit({ type: 'CAMERA_STATUS', data: currentStatus(cameraId) });
}

export function simulateBurst(cameraId: string, n = 4) {
  for (let i = 0; i < n; i++) setTimeout(() => nextSpawn.set(cameraId, 0), i * 600);
}
